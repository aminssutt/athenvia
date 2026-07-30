import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@prisma/client";

import { createCanonicalFieldRevision } from "../src/canonical-revisions";

const ids = {
  entity: "0f043d91-d700-4ee1-8f66-9a65c7e59301",
  snapshot: "a36c01ef-dc33-4b3c-937b-fbef8ce01e3f",
  source: "c78b0b53-cd70-44b9-a257-9c42e7914f04",
};

function input(proposedValue: Prisma.InputJsonValue | null) {
  return {
    creator: { kind: "WORKER" as const },
    currentValue: { day: 15, month: 1 },
    entityId: ids.entity,
    entityType: "APPLICATION_WINDOW",
    fieldName: "closesAt",
    proposedValue,
    sourceId: ids.source,
    sourceSnapshotId: ids.snapshot,
  };
}

function fakeDatabase() {
  const rows: Array<{
    changeStatus: "PENDING";
    conflictKey: string;
    hasConflict: boolean;
    id: string;
    newValue: unknown;
  }> = [];
  const transaction = {
    $executeRaw: async () => 1,
    dataRevision: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `revision-${rows.length + 1}`;
        rows.push({
          changeStatus: "PENDING",
          conflictKey: String(data.conflictKey),
          hasConflict: Boolean(data.hasConflict),
          id,
          newValue: data.newValue,
        });
        return { id };
      },
      findMany: async ({ where }: { where: { conflictKey: string } }) =>
        rows
          .filter(({ conflictKey }) => conflictKey === where.conflictKey)
          .map(({ id, newValue }) => ({ id, newValue })),
      updateMany: async ({ where }: { where: { conflictKey: string } }) => {
        for (const row of rows) {
          if (row.conflictKey === where.conflictKey) {
            row.hasConflict = true;
          }
        }
        return { count: rows.length };
      },
    },
    sourceSnapshot: {
      findFirst: async () => ({ id: ids.snapshot }),
    },
  };
  return {
    database: {
      $transaction: async (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
    },
    rows,
  };
}

test("does not create a revision when the canonical JSON value is unchanged", async () => {
  let transactionStarted = false;
  const result = await createCanonicalFieldRevision(
    {
      $transaction: async () => {
        transactionStarted = true;
        throw new Error("not expected");
      },
    } as never,
    input({ month: 1, day: 15 }),
  );

  assert.equal(result.outcome, "UNCHANGED");
  assert.equal(result.revisionId, null);
  assert.equal(transactionStarted, false);
});

test("is idempotent for equal proposals and marks competing proposals as conflicts", async () => {
  const fake = fakeDatabase();
  const first = await createCanonicalFieldRevision(
    fake.database as never,
    input({ day: 20, month: 1 }),
  );
  const repeated = await createCanonicalFieldRevision(
    fake.database as never,
    input({ month: 1, day: 20 }),
  );
  const conflicting = await createCanonicalFieldRevision(
    fake.database as never,
    input({ day: 25, month: 1 }),
  );

  assert.equal(first.outcome, "PENDING");
  assert.equal(repeated.revisionId, first.revisionId);
  assert.equal(conflicting.outcome, "CONFLICT");
  assert.equal(fake.rows.length, 2);
  assert.equal(
    fake.rows.every(({ hasConflict }) => hasConflict),
    true,
  );
});

test("rejects malformed revision identities before opening a transaction", async () => {
  await assert.rejects(
    createCanonicalFieldRevision({} as never, {
      ...input("2027-01-20"),
      entityId: "not-a-uuid",
    }),
    TypeError,
  );
});
