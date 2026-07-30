import { z } from "zod";

import { database } from "./client";

import type { Prisma } from "@prisma/client";

const CanonicalContentHashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

const SourceSnapshotIdentitySchema = z
  .object({
    sourceId: z.string().uuid(),
    contentHash: CanonicalContentHashSchema,
  })
  .strict();

const SourceSnapshotInputSchema = z
  .object({
    sourceId: z.string().uuid(),
    contentHash: CanonicalContentHashSchema,
    capturedAt: z.date(),
  })
  .strict();

const snapshotEvidenceSelection = {
  id: true,
  sourceId: true,
  storageKey: true,
  contentHash: true,
  capturedAt: true,
  source: {
    select: {
      universityId: true,
      programId: true,
    },
  },
} satisfies Prisma.SourceSnapshotSelect;

export type SourceSnapshotEvidence = Prisma.SourceSnapshotGetPayload<{
  select: typeof snapshotEvidenceSelection;
}>;

export type RecordSourceSnapshotInput = z.input<typeof SourceSnapshotInputSchema>;

export type SourceSnapshotIdentity = z.input<typeof SourceSnapshotIdentitySchema>;

export type RecordSourceSnapshotResult = {
  created: boolean;
  snapshot: SourceSnapshotEvidence;
};

export class SnapshotSourceNotFoundError extends Error {
  constructor() {
    super("The source for this snapshot does not exist.");
    this.name = "SnapshotSourceNotFoundError";
  }
}

export class SnapshotStorageKeyConflictError extends Error {
  constructor() {
    super("The snapshot storage key is already assigned to different evidence.");
    this.name = "SnapshotStorageKeyConflictError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

export function sourceSnapshotStorageKey(rawIdentity: SourceSnapshotIdentity): string {
  const identity = SourceSnapshotIdentitySchema.parse(rawIdentity);
  const digest = identity.contentHash.slice("sha256:".length);
  return `source-snapshots/${identity.sourceId}/${digest}.bin`;
}

async function markSourceChecked(
  client: Pick<Prisma.TransactionClient, "source">,
  sourceId: string,
  contentHash: string,
  capturedAt: Date,
): Promise<void> {
  await client.source.updateMany({
    where: {
      id: sourceId,
      OR: [
        { lastCheckedAt: null },
        {
          lastCheckedAt: {
            lt: capturedAt,
          },
        },
      ],
    },
    data: {
      contentHash,
      lastCheckedAt: capturedAt,
    },
  });
}

/**
 * Appends content-addressed evidence and atomically advances the source's
 * latest hash. The unique database constraint is the concurrency authority.
 */
export async function recordSourceSnapshot(
  rawInput: RecordSourceSnapshotInput,
): Promise<RecordSourceSnapshotResult> {
  const input = SourceSnapshotInputSchema.parse(rawInput);
  const storageKey = sourceSnapshotStorageKey({
    sourceId: input.sourceId,
    contentHash: input.contentHash,
  });

  try {
    const snapshot = await database.$transaction(async (transaction) => {
      const source = await transaction.source.findUnique({
        where: { id: input.sourceId },
        select: {
          id: true,
          universityId: true,
          programId: true,
        },
      });
      if (!source) {
        throw new SnapshotSourceNotFoundError();
      }

      const created = await transaction.sourceSnapshot.create({
        data: {
          ...input,
          storageKey,
        },
        select: snapshotEvidenceSelection,
      });
      await markSourceChecked(transaction, source.id, input.contentHash, input.capturedAt);

      return created;
    });

    return { created: true, snapshot };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existing = await database.sourceSnapshot.findUnique({
      where: {
        sourceId_contentHash: {
          sourceId: input.sourceId,
          contentHash: input.contentHash,
        },
      },
      select: snapshotEvidenceSelection,
    });
    if (!existing) {
      throw new SnapshotStorageKeyConflictError();
    }
    if (existing.storageKey !== storageKey) {
      throw new SnapshotStorageKeyConflictError();
    }

    await markSourceChecked(database, input.sourceId, input.contentHash, input.capturedAt);
    return { created: false, snapshot: existing };
  }
}
