import { Prisma, type PrismaClient } from "@prisma/client";

type RevisionDatabase = Pick<PrismaClient, "$transaction">;

export type RevisionCreator =
  Readonly<{ kind: "USER"; userId: string }> | Readonly<{ kind: "WORKER" }>;

export type CanonicalRevisionInput = Readonly<{
  creator: RevisionCreator;
  currentValue: Prisma.InputJsonValue | null;
  entityId: string;
  entityType: string;
  fieldName: string;
  proposedValue: Prisma.InputJsonValue | null;
  sourceId: string;
  sourceSnapshotId: string;
}>;

export type CanonicalRevisionResult = Readonly<{
  conflictKey: string;
  outcome: "CONFLICT" | "PENDING" | "UNCHANGED";
  revisionId: string | null;
}>;

export class RevisionEvidenceNotFoundError extends Error {
  constructor() {
    super("The immutable source snapshot does not belong to the supplied source.");
    this.name = "RevisionEvidenceNotFoundError";
  }
}

function stableJson(value: Prisma.InputJsonValue | null): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : Number(left > right)))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function assertInput(input: CanonicalRevisionInput): void {
  const identifier = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  if (
    !identifier.test(input.entityId) ||
    !identifier.test(input.sourceId) ||
    !identifier.test(input.sourceSnapshotId) ||
    (input.creator.kind === "USER" && !identifier.test(input.creator.userId))
  ) {
    throw new TypeError("Revision entity, source, snapshot and user IDs must be UUIDs.");
  }
  if (
    !/^[A-Z][A-Z0-9_]{1,79}$/u.test(input.entityType) ||
    !/^[a-z][a-zA-Z0-9_]{0,79}$/u.test(input.fieldName)
  ) {
    throw new TypeError("Revision entityType or fieldName is invalid.");
  }
}

function jsonValue(value: Prisma.InputJsonValue | null) {
  return value === null ? Prisma.JsonNull : value;
}

export async function createCanonicalFieldRevision(
  database: RevisionDatabase,
  input: CanonicalRevisionInput,
): Promise<CanonicalRevisionResult> {
  assertInput(input);
  const conflictKey = `${input.entityType}:${input.entityId}:${input.fieldName}`;
  if (stableJson(input.currentValue) === stableJson(input.proposedValue)) {
    return Object.freeze({ conflictKey, outcome: "UNCHANGED", revisionId: null });
  }

  return database.$transaction(async (transaction) => {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${conflictKey}, 0))`;
    const snapshot = await transaction.sourceSnapshot.findFirst({
      where: { id: input.sourceSnapshotId, sourceId: input.sourceId },
      select: { id: true },
    });
    if (!snapshot) {
      throw new RevisionEvidenceNotFoundError();
    }

    const pending = await transaction.dataRevision.findMany({
      where: { changeStatus: "PENDING", conflictKey },
      orderBy: { createdAt: "asc" },
      select: { id: true, newValue: true },
    });
    const proposedJson = stableJson(input.proposedValue);
    const idempotent = pending.find(
      ({ newValue }) => stableJson(newValue as Prisma.InputJsonValue) === proposedJson,
    );
    if (idempotent) {
      return Object.freeze({
        conflictKey,
        outcome: pending.length > 1 ? "CONFLICT" : "PENDING",
        revisionId: idempotent.id,
      });
    }

    const hasConflict = pending.length > 0;
    if (hasConflict) {
      await transaction.dataRevision.updateMany({
        where: { changeStatus: "PENDING", conflictKey },
        data: { hasConflict: true },
      });
    }
    const revision = await transaction.dataRevision.create({
      data: {
        conflictKey,
        createdByUserId: input.creator.kind === "USER" ? input.creator.userId : null,
        createdByWorker: input.creator.kind === "WORKER",
        entityId: input.entityId,
        entityType: input.entityType,
        fieldName: input.fieldName,
        hasConflict,
        newValue: jsonValue(input.proposedValue),
        oldValue: jsonValue(input.currentValue),
        sourceId: input.sourceId,
        sourceSnapshotId: input.sourceSnapshotId,
      },
      select: { id: true },
    });
    return Object.freeze({
      conflictKey,
      outcome: hasConflict ? "CONFLICT" : "PENDING",
      revisionId: revision.id,
    });
  });
}
