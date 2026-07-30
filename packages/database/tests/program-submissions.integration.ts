import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { database } from "../src/client";
import {
  ActiveUniversityNotFoundError,
  createPendingProgramSubmission,
} from "../src/program-submissions";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a migrated PostgreSQL database.");
}

const suffix = randomUUID().slice(0, 8);
const owner = await database.user.create({
  data: {
    email: `program-submission-${suffix}@example.test`,
  },
  select: { id: true },
});
const activeUniversity = await database.university.create({
  data: {
    name: `Université Active ${suffix}`,
    normalizedName: `universite-active-${suffix}`,
    countryCode: "FR",
    status: "ACTIVE",
  },
  select: { id: true, name: true },
});
const inactiveUniversity = await database.university.create({
  data: {
    name: `Université Pending ${suffix}`,
    normalizedName: `universite-pending-${suffix}`,
    countryCode: "FR",
    status: "PENDING",
  },
  select: { id: true, name: true },
});

try {
  const created = await createPendingProgramSubmission({
    submittedByUserId: owner.id,
    universityId: activeUniversity.id,
    universityName: `  ${activeUniversity.name.toLocaleUpperCase("en")}  `,
    name: "MSc Responsible AI",
    degreeType: "MASTER",
    domain: "Artificial intelligence",
    officialUrl: "https://example.edu/responsible-ai",
  });

  assert.equal(created.status, "PENDING");
  const stored = await database.programSubmission.findUniqueOrThrow({
    where: { id: created.id },
  });
  assert.equal(stored.submittedByUserId, owner.id);
  assert.equal(stored.universityId, activeUniversity.id);
  assert.equal(stored.status, "PENDING");
  assert.equal(stored.reviewedAt, null);
  assert.equal(stored.officialUrl, "https://example.edu/responsible-ai");

  await assert.rejects(
    createPendingProgramSubmission({
      submittedByUserId: owner.id,
      universityId: activeUniversity.id,
      universityName: "A different university",
      name: "MSc Mismatched Context",
      degreeType: "MASTER",
      domain: "Management",
      officialUrl: null,
    }),
    ActiveUniversityNotFoundError,
  );

  await assert.rejects(
    createPendingProgramSubmission({
      submittedByUserId: owner.id,
      universityId: inactiveUniversity.id,
      universityName: inactiveUniversity.name,
      name: "MSc Inactive University",
      degreeType: "MASTER",
      domain: "Management",
      officialUrl: null,
    }),
    ActiveUniversityNotFoundError,
  );

  await assert.rejects(
    createPendingProgramSubmission({
      submittedByUserId: randomUUID(),
      universityId: activeUniversity.id,
      universityName: activeUniversity.name,
      name: "MSc Invalid Owner",
      degreeType: "MASTER",
      domain: "Management",
      officialUrl: null,
    }),
  );

  assert.equal(
    await database.programSubmission.count({
      where: {
        name: {
          in: ["MSc Mismatched Context", "MSc Inactive University", "MSc Invalid Owner"],
        },
      },
    }),
    0,
  );
} finally {
  await database.user.deleteMany({ where: { id: owner.id } });
  await database.university.deleteMany({
    where: { id: { in: [activeUniversity.id, inactiveUniversity.id] } },
  });
  await database.$disconnect();
}

console.log("Program submission integration checks passed.");
