import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { database } from "../src/client";
import { DUPLICATE_REVIEW_FIELD } from "../src/duplicate-detection";
import { createPendingProgramSubmission } from "../src/program-submissions";
import { createPendingUniversitySubmission } from "../src/university-submissions";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a disposable, migrated PostgreSQL database.");
}

const suffix = randomUUID().slice(0, 8);
const user = await database.user.create({
  data: { email: `duplicate-review-${suffix}@example.test` },
  select: { id: true },
});
const university = await database.university.create({
  data: {
    name: `École Polytechnique ${suffix}`,
    normalizedName: `ecole polytechnique ${suffix}`,
    countryCode: "FR",
    officialDomain: `polytechnique-${suffix}.edu`,
    officialWebsite: `https://polytechnique-${suffix}.edu/`,
    status: "ACTIVE",
    aliases: {
      create: {
        alias: `L'X ${suffix}`,
        normalizedAlias: `l x ${suffix}`,
      },
    },
  },
  select: { id: true, name: true },
});
const program = await database.program.create({
  data: {
    universityId: university.id,
    name: "MSc Data & AI",
    normalizedName: "msc data and ai",
    degreeType: "MASTER",
    officialUrl: `https://polytechnique-${suffix}.edu/programs/data-ai`,
    status: "ACTIVE",
  },
  select: { id: true },
});

const likelyUniversity = await createPendingUniversitySubmission({
  submittedByUserId: user.id,
  name: `Ecole Polytechnique ${suffix}`,
  countryCode: "FR",
  officialWebsite: `https://www.polytechnique-${suffix}.edu/admissions`,
});
const distinctUniversity = await createPendingUniversitySubmission({
  submittedByUserId: user.id,
  name: `Distinct Conservatory ${suffix}`,
  countryCode: "FR",
  officialWebsite: null,
});
const likelyProgram = await createPendingProgramSubmission({
  submittedByUserId: user.id,
  universityId: university.id,
  universityName: university.name,
  name: "MSc Data and AI",
  degreeType: "MASTER",
  domain: "Data Science",
  officialUrl: `https://polytechnique-${suffix}.edu/programs/data-ai?source=form`,
});

const universityReview = await database.dataRevision.findFirst({
  where: {
    entityType: "UNIVERSITY_SUBMISSION",
    entityId: likelyUniversity.id,
    fieldName: DUPLICATE_REVIEW_FIELD,
    changeStatus: "PENDING",
  },
});
assert.ok(universityReview);
assert.match(JSON.stringify(universityReview.newValue), new RegExp(university.id, "u"));

assert.equal(
  await database.dataRevision.count({
    where: {
      entityType: "UNIVERSITY_SUBMISSION",
      entityId: distinctUniversity.id,
      fieldName: DUPLICATE_REVIEW_FIELD,
    },
  }),
  0,
);

const programReview = await database.dataRevision.findFirst({
  where: {
    entityType: "PROGRAM_SUBMISSION",
    entityId: likelyProgram.id,
    fieldName: DUPLICATE_REVIEW_FIELD,
    changeStatus: "PENDING",
  },
});
assert.ok(programReview);
assert.match(JSON.stringify(programReview.newValue), new RegExp(program.id, "u"));

assert.equal(await database.university.count({ where: { id: university.id } }), 1);
assert.equal(await database.program.count({ where: { id: program.id } }), 1);
assert.equal(likelyUniversity.status, "PENDING");
assert.equal(likelyProgram.status, "PENDING");

await database.$disconnect();
process.stdout.write("Duplicate detection review integration checks passed.\n");
