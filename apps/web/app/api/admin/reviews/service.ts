import { database, type Prisma } from "@athenvia/database";

export type AdminReviewItem = {
  conflictKey: string | null;
  createdAt: string;
  creator: string;
  entityId: string;
  entityType: string;
  fieldName: string;
  hasConflict: boolean;
  id: string;
  newValue: Prisma.JsonValue | null;
  oldValue: Prisma.JsonValue | null;
  source: {
    capturedAt: string | null;
    isOfficial: boolean;
    sourceType: string;
    url: string;
  } | null;
};

export class AdminReviewConflictError extends Error {
  constructor() {
    super("Reject the competing pending values before approving this revision.");
    this.name = "AdminReviewConflictError";
  }
}

export class AdminReviewNotFoundError extends Error {
  constructor() {
    super("The pending revision no longer exists.");
    this.name = "AdminReviewNotFoundError";
  }
}

export async function listPendingAdminReviews(): Promise<AdminReviewItem[]> {
  const revisions = await database.dataRevision.findMany({
    where: { changeStatus: "PENDING" },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: 100,
    select: {
      conflictKey: true,
      createdAt: true,
      createdBy: { select: { email: true } },
      createdByWorker: true,
      entityId: true,
      entityType: true,
      fieldName: true,
      hasConflict: true,
      id: true,
      newValue: true,
      oldValue: true,
      source: { select: { isOfficial: true, sourceType: true, url: true } },
      sourceSnapshot: { select: { capturedAt: true } },
    },
  });
  return revisions.map((revision) => ({
    conflictKey: revision.conflictKey,
    createdAt: revision.createdAt.toISOString(),
    creator: revision.createdByWorker
      ? "Athenvia verification worker"
      : (revision.createdBy?.email ?? "Unknown reviewer"),
    entityId: revision.entityId,
    entityType: revision.entityType,
    fieldName: revision.fieldName,
    hasConflict: revision.hasConflict,
    id: revision.id,
    newValue: revision.newValue,
    oldValue: revision.oldValue,
    source: revision.source
      ? {
          capturedAt: revision.sourceSnapshot?.capturedAt.toISOString() ?? null,
          isOfficial: revision.source.isOfficial,
          sourceType: revision.source.sourceType,
          url: revision.source.url,
        }
      : null,
  }));
}

export async function decideAdminReview(
  revisionId: string,
  reviewerId: string,
  decision: "APPROVE" | "REJECT",
): Promise<void> {
  return decideAdminReviewWith(database, revisionId, reviewerId, decision);
}

export async function decideAdminReviewWith(
  databaseClient: Pick<typeof database, "$transaction">,
  revisionId: string,
  reviewerId: string,
  decision: "APPROVE" | "REJECT",
): Promise<void> {
  await databaseClient.$transaction(async (transaction) => {
    const revision = await transaction.dataRevision.findFirst({
      where: { changeStatus: "PENDING", id: revisionId },
      select: {
        conflictKey: true,
        hasConflict: true,
        id: true,
        sourceId: true,
        sourceSnapshotId: true,
      },
    });
    if (!revision) {
      throw new AdminReviewNotFoundError();
    }

    if (decision === "APPROVE" && revision.hasConflict && revision.conflictKey) {
      const competitors = await transaction.dataRevision.count({
        where: {
          changeStatus: "PENDING",
          conflictKey: revision.conflictKey,
          id: { not: revision.id },
        },
      });
      if (competitors > 0) {
        throw new AdminReviewConflictError();
      }
    }

    const changeStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    await transaction.dataRevision.update({
      where: { id: revision.id },
      data: {
        changeStatus,
        hasConflict: decision === "APPROVE" ? false : revision.hasConflict,
        reviewedAt: new Date(),
      },
    });
    await transaction.dataRevision.create({
      data: {
        changeStatus: "APPROVED",
        createdByUserId: reviewerId,
        createdByWorker: false,
        entityId: revision.id,
        entityType: "DATA_REVISION",
        fieldName: "reviewDecision",
        newValue: { changeStatus, reviewerId },
        oldValue: { changeStatus: "PENDING" },
        reviewedAt: new Date(),
        sourceId: revision.sourceId,
        sourceSnapshotId: revision.sourceSnapshotId,
      },
    });
  });
}
