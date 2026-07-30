import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { database } from "../src/client";
import { createCanonicalFieldRevision } from "../src/canonical-revisions";

const suffix = randomUUID();
const user = await database.user.create({
  data: { email: `revision-${suffix}@example.test` },
});
const source = await database.source.create({
  data: {
    isOfficial: true,
    sourceType: "PROGRAM_PAGE",
    url: `https://example.test/${suffix}`,
  },
});
const digest = `sha256:${"a".repeat(64)}`;
const snapshot = await database.sourceSnapshot.create({
  data: {
    contentHash: digest,
    sourceId: source.id,
    storageKey: `source-snapshots/${source.id}/${"a".repeat(64)}.bin`,
  },
});
const entityId = randomUUID();

try {
  const unchanged = await createCanonicalFieldRevision(database, {
    creator: { kind: "WORKER" },
    currentValue: "2027-01-15",
    entityId,
    entityType: "APPLICATION_WINDOW",
    fieldName: "closesAt",
    proposedValue: "2027-01-15",
    sourceId: source.id,
    sourceSnapshotId: snapshot.id,
  });
  assert.equal(unchanged.outcome, "UNCHANGED");
  assert.equal(await database.dataRevision.count({ where: { entityId } }), 0);

  const first = await createCanonicalFieldRevision(database, {
    creator: { kind: "USER", userId: user.id },
    currentValue: "2027-01-15",
    entityId,
    entityType: "APPLICATION_WINDOW",
    fieldName: "closesAt",
    proposedValue: "2027-01-20",
    sourceId: source.id,
    sourceSnapshotId: snapshot.id,
  });
  assert.equal(first.outcome, "PENDING");
  assert.ok(first.revisionId);

  const repeated = await createCanonicalFieldRevision(database, {
    creator: { kind: "USER", userId: user.id },
    currentValue: "2027-01-15",
    entityId,
    entityType: "APPLICATION_WINDOW",
    fieldName: "closesAt",
    proposedValue: "2027-01-20",
    sourceId: source.id,
    sourceSnapshotId: snapshot.id,
  });
  assert.equal(repeated.revisionId, first.revisionId);
  assert.equal(await database.dataRevision.count({ where: { entityId } }), 1);

  const conflicting = await createCanonicalFieldRevision(database, {
    creator: { kind: "WORKER" },
    currentValue: "2027-01-15",
    entityId,
    entityType: "APPLICATION_WINDOW",
    fieldName: "closesAt",
    proposedValue: "2027-01-25",
    sourceId: source.id,
    sourceSnapshotId: snapshot.id,
  });
  assert.equal(conflicting.outcome, "CONFLICT");
  assert.equal(
    await database.dataRevision.count({
      where: { entityId, hasConflict: true, sourceId: source.id, sourceSnapshotId: snapshot.id },
    }),
    2,
  );

  await assert.rejects(
    database.dataRevision.update({
      where: { id: first.revisionId! },
      data: { changeStatus: "APPROVED" },
    }),
  );
  await assert.rejects(
    database.dataRevision.update({
      where: { id: first.revisionId! },
      data: { oldValue: "mutated" },
    }),
  );
  await assert.rejects(database.source.delete({ where: { id: source.id } }));
  await assert.rejects(database.user.delete({ where: { id: user.id } }));
} finally {
  await database.$disconnect();
}
