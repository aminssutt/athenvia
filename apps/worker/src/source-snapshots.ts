import { createHash } from "node:crypto";

import {
  recordSourceSnapshot,
  sourceSnapshotStorageKey,
  type RecordSourceSnapshotInput,
  type RecordSourceSnapshotResult,
} from "@athenvia/database";

export type ImmutableSnapshotObject = {
  body: Buffer;
  contentHash: string;
  contentType: string;
  key: string;
};

/**
 * Implementations must create the object atomically and never overwrite an
 * existing key. A retry returns `created: false` for the same immutable object.
 */
export type ImmutableSnapshotStore = {
  putIfAbsent(object: ImmutableSnapshotObject): Promise<{ created: boolean }>;
};

export type StoreSourceSnapshotInput = {
  body: Uint8Array;
  capturedAt: Date;
  contentType: string;
  sourceId: string;
};

export type StoreSourceSnapshotDependencies = {
  objectStore: ImmutableSnapshotStore;
  persistSnapshot?: (input: RecordSourceSnapshotInput) => Promise<RecordSourceSnapshotResult>;
};

export type StoreSourceSnapshotResult = RecordSourceSnapshotResult & {
  objectCreated: boolean;
};

export function canonicalSourceContentHash(body: Uint8Array): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

/**
 * Writes bytes before metadata. A database failure can leave an unreferenced,
 * content-addressed object, but never a database row pointing at missing bytes.
 * The deterministic key makes the operation safe to retry.
 */
export async function storeSourceSnapshot(
  input: StoreSourceSnapshotInput,
  dependencies: StoreSourceSnapshotDependencies,
): Promise<StoreSourceSnapshotResult> {
  if (!(input.capturedAt instanceof Date) || Number.isNaN(input.capturedAt.valueOf())) {
    throw new TypeError("capturedAt must be a valid Date.");
  }
  if (typeof input.contentType !== "string" || input.contentType.trim().length === 0) {
    throw new TypeError("contentType must be a non-empty string.");
  }

  const body = Buffer.from(input.body);
  const contentHash = canonicalSourceContentHash(body);
  const key = sourceSnapshotStorageKey({
    sourceId: input.sourceId,
    contentHash,
  });

  const storedObject = await dependencies.objectStore.putIfAbsent({
    body,
    contentHash,
    contentType: input.contentType,
    key,
  });
  const persisted = await (dependencies.persistSnapshot ?? recordSourceSnapshot)({
    sourceId: input.sourceId,
    contentHash,
    capturedAt: input.capturedAt,
  });

  if (persisted.snapshot.contentHash !== contentHash || persisted.snapshot.storageKey !== key) {
    throw new Error("Persisted snapshot evidence does not match the immutable object.");
  }

  return {
    ...persisted,
    objectCreated: storedObject.created,
  };
}
