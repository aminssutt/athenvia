import { database, SUBMISSION_REVIEW_FIELD, type Prisma } from "@athenvia/database";

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

export class AdminReviewApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminReviewApplyError";
  }
}

export class AdminReviewNotFoundError extends Error {
  constructor() {
    super("The pending revision no longer exists.");
    this.name = "AdminReviewNotFoundError";
  }
}

/**
 * Human-readable provenance for the review card ("Proposed by …").
 * Submission reviews are filed by the contributing student, so they read
 * "a student (email)" rather than a reviewer identity; an anonymized account
 * keeps the neutral label without leaking the placeholder address.
 */
export function describeCreator(revision: {
  createdBy: { email: string } | null;
  createdByWorker: boolean;
  fieldName: string;
}): string {
  if (revision.createdByWorker) {
    return "Athenvia verification worker";
  }
  if (revision.fieldName === SUBMISSION_REVIEW_FIELD) {
    const email = revision.createdBy?.email;
    return email && !email.endsWith("@deleted.invalid")
      ? `a student (${email})`
      : "a student (account deleted)";
  }
  return revision.createdBy?.email ?? "Unknown reviewer";
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
    creator: describeCreator(revision),
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

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const ISO_INSTANT_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;

function parseApprovedWindowDate(value: Prisma.JsonValue | null): Date | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new AdminReviewApplyError("The approved value is not a date and cannot be applied.");
  }
  // A day-precision deadline is stored at noon UTC: the same calendar day in
  // every timezone, never after an end-of-day cutoff.
  const instant = ISO_DATE_PATTERN.test(value)
    ? new Date(`${value}T12:00:00.000Z`)
    : ISO_INSTANT_PATTERN.test(value)
      ? new Date(value)
      : null;
  if (instant === null || !Number.isFinite(instant.getTime())) {
    throw new AdminReviewApplyError(
      "The approved value is not a valid date and cannot be applied.",
    );
  }
  return instant;
}

type ApplicationWindowDateRevision = {
  entityId: string;
  fieldName: "opensAt" | "closesAt";
  newValue: Prisma.JsonValue | null;
  sourceId: string | null;
  sourceLastCheckedAt: Date | null;
};

/**
 * Applies an approved application-window date to the canonical row in the
 * same transaction as the review decision. The evidence trigger demands an
 * official source and a verification instant no later than that source's
 * last check, so the source's `lastCheckedAt` becomes the new
 * `lastVerifiedAt`; a re-verification that would move the instant backwards
 * is refused instead of silently approving without publishing.
 */
async function applyApplicationWindowDate(
  transaction: Pick<Prisma.TransactionClient, "applicationWindow">,
  revision: ApplicationWindowDateRevision,
): Promise<void> {
  const approvedDate = parseApprovedWindowDate(revision.newValue);
  const window = await transaction.applicationWindow.findUnique({
    where: { id: revision.entityId },
    select: { closesAt: true, id: true, lastVerifiedAt: true, opensAt: true, publicStatus: true },
  });
  if (!window) {
    throw new AdminReviewApplyError("The application window for this revision no longer exists.");
  }

  const currentDate = revision.fieldName === "opensAt" ? window.opensAt : window.closesAt;
  const nextOpensAt = revision.fieldName === "opensAt" ? approvedDate : window.opensAt;
  const nextClosesAt = revision.fieldName === "closesAt" ? approvedDate : window.closesAt;
  const nextStatus = nextOpensAt === null && nextClosesAt === null ? "NOT_PUBLISHED" : "CONFIRMED";
  if (
    (currentDate?.getTime() ?? null) === (approvedDate?.getTime() ?? null) &&
    window.publicStatus === nextStatus
  ) {
    return;
  }

  if (revision.sourceId === null || revision.sourceLastCheckedAt === null) {
    throw new AdminReviewApplyError(
      "This revision has no checked official source, so the application window cannot be updated.",
    );
  }
  if (
    window.lastVerifiedAt !== null &&
    revision.sourceLastCheckedAt.getTime() <= window.lastVerifiedAt.getTime()
  ) {
    throw new AdminReviewApplyError(
      "The window was verified after this revision's evidence was collected. Re-run verification, then review the fresh revision.",
    );
  }

  await transaction.applicationWindow.update({
    where: { id: window.id },
    data: {
      [revision.fieldName]: approvedDate,
      lastVerifiedAt: revision.sourceLastCheckedAt,
      publicStatus: nextStatus,
      sourceId: revision.sourceId,
      verification: "OFFICIAL",
    },
  });
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
        entityId: true,
        entityType: true,
        fieldName: true,
        hasConflict: true,
        id: true,
        newValue: true,
        source: { select: { lastCheckedAt: true } },
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

    if (
      decision === "APPROVE" &&
      revision.entityType === "APPLICATION_WINDOW" &&
      (revision.fieldName === "opensAt" || revision.fieldName === "closesAt")
    ) {
      await applyApplicationWindowDate(transaction, {
        entityId: revision.entityId,
        fieldName: revision.fieldName,
        newValue: revision.newValue,
        sourceId: revision.sourceId,
        sourceLastCheckedAt: revision.source?.lastCheckedAt ?? null,
      });
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
    if (revision.fieldName === "submissionReview") {
      const submissionStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
      if (revision.entityType === "UNIVERSITY_SUBMISSION") {
        await transaction.universitySubmission.update({
          where: { id: revision.entityId },
          data: { reviewedAt: new Date(), status: submissionStatus },
        });
      } else if (revision.entityType === "PROGRAM_SUBMISSION") {
        await transaction.programSubmission.update({
          where: { id: revision.entityId },
          data: { reviewedAt: new Date(), status: submissionStatus },
        });
      }
    }
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
