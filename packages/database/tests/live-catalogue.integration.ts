import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { database } from "../src/client";
import { importSeedFiles, SeedSummaryConflictError, stableSeedUuid } from "../src/seed-import";
import { readSeedFile } from "../src/seed-format";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a disposable, migrated PostgreSQL database.");
}

const suffix = randomUUID().slice(0, 8);
const university = await database.university.create({
  data: {
    countryCode: "FR",
    name: `Catalogue evidence ${suffix}`,
    normalizedName: `catalogue evidence ${suffix}`,
    status: "ACTIVE",
  },
  select: { id: true },
});

try {
  const firstProgram = await database.program.create({
    data: {
      degreeType: "MASTER",
      name: `Evidence programme ${suffix}`,
      normalizedName: `evidence programme ${suffix}`,
      status: "ACTIVE",
      universityId: university.id,
    },
    select: { id: true },
  });
  const secondProgram = await database.program.create({
    data: {
      degreeType: "MASTER",
      name: `Other evidence programme ${suffix}`,
      normalizedName: `other evidence programme ${suffix}`,
      status: "ACTIVE",
      universityId: university.id,
    },
    select: { id: true },
  });
  const checkedAt = new Date("2026-07-30T12:00:00.000Z");
  const officialSource = await database.source.create({
    data: {
      isOfficial: true,
      lastCheckedAt: checkedAt,
      programId: firstProgram.id,
      sourceType: "PROGRAM_PAGE",
      universityId: university.id,
      url: `https://catalogue-${suffix}.example.edu/programme`,
    },
    select: { id: true },
  });
  const unofficialSource = await database.source.create({
    data: {
      isOfficial: false,
      lastCheckedAt: checkedAt,
      programId: secondProgram.id,
      sourceType: "COMMUNITY_PAGE",
      universityId: university.id,
      url: `https://catalogue-${suffix}.example.edu/community`,
    },
    select: { id: true },
  });
  const otherProgramSource = await database.source.create({
    data: {
      isOfficial: true,
      lastCheckedAt: checkedAt,
      programId: secondProgram.id,
      sourceType: "PROGRAM_PAGE",
      universityId: university.id,
      url: `https://catalogue-${suffix}.example.edu/other-programme`,
    },
    select: { id: true },
  });

  await database.programSummary.create({
    data: {
      lastVerifiedAt: checkedAt,
      programId: firstProgram.id,
      sourceId: officialSource.id,
      text: "A concise official-source-backed programme summary used to verify canonical persistence.",
    },
  });
  assert.equal(
    (
      await database.programSummary.findUniqueOrThrow({
        where: { programId: firstProgram.id },
        select: { sourceId: true },
      })
    ).sourceId,
    officialSource.id,
  );

  await assert.rejects(
    database.programSummary.create({
      data: {
        lastVerifiedAt: checkedAt,
        programId: secondProgram.id,
        sourceId: unofficialSource.id,
        text: "This deliberately long programme summary must fail only because its supporting source is not marked as official evidence.",
      },
    }),
  );
  await assert.rejects(
    database.programSummary.update({
      where: { programId: firstProgram.id },
      data: {
        lastVerifiedAt: new Date("2026-07-30T11:59:59.000Z"),
      },
    }),
  );
  await assert.rejects(
    database.programSummary.update({
      where: { programId: firstProgram.id },
      data: {
        sourceId: otherProgramSource.id,
      },
    }),
  );

  const intake = await database.intake.create({
    data: {
      month: 9,
      programId: firstProgram.id,
      status: "PLANNED",
      year: 2027,
    },
    select: { id: true },
  });
  const applicationWindow = await database.applicationWindow.create({
    data: {
      intakeId: intake.id,
      lastVerifiedAt: checkedAt,
      publicStatus: "NOT_PUBLISHED",
      sourceId: officialSource.id,
      verification: "OFFICIAL",
    },
    select: { id: true },
  });
  await assert.rejects(
    database.applicationWindow.create({
      data: {
        intakeId: intake.id,
        lastVerifiedAt: checkedAt,
        publicStatus: "NOT_PUBLISHED",
        sourceId: otherProgramSource.id,
        verification: "OFFICIAL",
      },
    }),
  );
  await assert.rejects(
    database.applicationWindow.create({
      data: {
        intakeId: intake.id,
        publicStatus: "NOT_PUBLISHED",
        sourceId: officialSource.id,
        verification: "OFFICIAL",
      },
    }),
  );
  await assert.rejects(
    database.source.update({
      where: { id: officialSource.id },
      data: { isOfficial: false },
    }),
  );
  await assert.rejects(
    database.applicationWindow.update({
      where: { id: applicationWindow.id },
      data: { roundName: "Conflicting round at the same instant" },
    }),
  );

  const sample = await readSeedFile(new URL("../../../data/seed/sample.json", import.meta.url));
  const firstImport = await importSeedFiles(database, [sample]);
  const secondImport = await importSeedFiles(database, [sample]);
  assert.deepEqual(secondImport, firstImport);
  assert.equal(firstImport.summaries, 1);

  const seededProgramId = stableSeedUuid("university:nus:program:msc-venture-creation");
  const persistedSummary = await database.programSummary.findUniqueOrThrow({
    where: { programId: seededProgramId },
    select: {
      sourceId: true,
      text: true,
    },
  });
  assert.equal(persistedSummary.text, sample.universities[0]!.programs[0]!.summary.text);
  const conflictingSeed = structuredClone(sample);
  conflictingSeed.universities[0]!.programs[0]!.summary.text = `${persistedSummary.text.slice(0, -1)}!`;
  await assert.rejects(importSeedFiles(database, [conflictingSeed]), SeedSummaryConflictError);
  await database.university.deleteMany({
    where: {
      id: stableSeedUuid("university:nus"),
    },
  });
} finally {
  await database.university.delete({ where: { id: university.id } });
  await database.$disconnect();
}

console.log("Live catalogue migration constraints passed.");
