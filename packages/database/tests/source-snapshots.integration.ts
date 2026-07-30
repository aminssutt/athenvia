import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { database } from "../src/client";
import { recordSourceSnapshot, sourceSnapshotStorageKey } from "../src/source-snapshots";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a disposable, migrated PostgreSQL database.");
}

const suffix = randomUUID().slice(0, 8);
const university = await database.university.create({
  data: {
    name: `Snapshot University ${suffix}`,
    normalizedName: `snapshot university ${suffix}`,
    countryCode: "FR",
    status: "ACTIVE",
  },
  select: { id: true },
});
const otherUniversity = await database.university.create({
  data: {
    name: `Other Snapshot University ${suffix}`,
    normalizedName: `other snapshot university ${suffix}`,
    countryCode: "FR",
    status: "ACTIVE",
  },
  select: { id: true },
});
const program = await database.program.create({
  data: {
    universityId: university.id,
    name: `Snapshot Program ${suffix}`,
    normalizedName: `snapshot program ${suffix}`,
    degreeType: "MASTER",
    status: "ACTIVE",
  },
  select: { id: true },
});
const universitySource = await database.source.create({
  data: {
    universityId: university.id,
    url: `https://snapshot-${suffix}.example.edu/admissions`,
    sourceType: "OFFICIAL_PAGE",
    isOfficial: true,
  },
  select: { id: true },
});
const programSource = await database.source.create({
  data: {
    programId: program.id,
    url: `https://snapshot-${suffix}.example.edu/program`,
    sourceType: "OFFICIAL_PAGE",
    isOfficial: true,
  },
  select: { id: true },
});

const hash = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const firstHash = hash("first immutable response");
const olderHash = hash("older immutable response");
const newestHash = hash("newest immutable response");
const capturedAt = new Date("2026-07-30T12:00:00.000Z");

const concurrent = await Promise.all(
  Array.from({ length: 4 }, () =>
    recordSourceSnapshot({
      sourceId: universitySource.id,
      contentHash: firstHash,
      capturedAt,
    }),
  ),
);

assert.equal(concurrent.filter(({ created }) => created).length, 1);
assert.equal(new Set(concurrent.map(({ snapshot }) => snapshot.id)).size, 1);
assert.deepEqual(concurrent[0]?.snapshot.source, {
  universityId: university.id,
  programId: null,
});
assert.equal(
  concurrent[0]?.snapshot.storageKey,
  sourceSnapshotStorageKey({
    sourceId: universitySource.id,
    contentHash: firstHash,
  }),
);

await recordSourceSnapshot({
  sourceId: universitySource.id,
  contentHash: olderHash,
  capturedAt: new Date("2026-07-29T12:00:00.000Z"),
});
let currentSource = await database.source.findUniqueOrThrow({
  where: { id: universitySource.id },
  select: { contentHash: true, lastCheckedAt: true },
});
assert.equal(currentSource.contentHash, firstHash);
assert.equal(currentSource.lastCheckedAt?.toISOString(), capturedAt.toISOString());

await recordSourceSnapshot({
  sourceId: universitySource.id,
  contentHash: newestHash,
  capturedAt: new Date("2026-07-31T12:00:00.000Z"),
});
currentSource = await database.source.findUniqueOrThrow({
  where: { id: universitySource.id },
  select: { contentHash: true, lastCheckedAt: true },
});
assert.equal(currentSource.contentHash, newestHash);
assert.equal(currentSource.lastCheckedAt?.toISOString(), "2026-07-31T12:00:00.000Z");

const programEvidence = await recordSourceSnapshot({
  sourceId: programSource.id,
  contentHash: firstHash,
  capturedAt,
});
assert.deepEqual(programEvidence.snapshot.source, {
  universityId: null,
  programId: program.id,
});

await assert.rejects(
  database.sourceSnapshot.update({
    where: { id: concurrent[0]!.snapshot.id },
    data: { capturedAt: new Date("2026-08-01T12:00:00.000Z") },
  }),
);
await assert.rejects(
  database.sourceSnapshot.delete({
    where: { id: concurrent[0]!.snapshot.id },
  }),
);
await assert.rejects(
  database.source.update({
    where: { id: universitySource.id },
    data: { universityId: otherUniversity.id },
  }),
);
await assert.rejects(
  database.university.delete({
    where: { id: university.id },
  }),
);

await assert.rejects(
  database.$executeRaw`
    INSERT INTO "source_snapshots"
      ("id", "source_id", "storage_key", "content_hash", "captured_at")
    VALUES (
      ${randomUUID()}::uuid,
      ${universitySource.id}::uuid,
      ${"source-snapshots/invalid.bin"},
      ${"sha256:not-a-digest"},
      NOW()
    )
  `,
);

await database.$disconnect();
process.stdout.write("Immutable source snapshot integration checks passed.\n");
