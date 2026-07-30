import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { database } from "../src/client";
import {
  publishApprovedProgramSubmission,
  publishApprovedUniversitySubmission,
} from "../src/publish-submissions";
import { createPendingProgramSubmission } from "../src/program-submissions";
import { SUBMISSION_REVIEW_FIELD } from "../src/submission-reviews";
import { createPendingUniversitySubmission } from "../src/university-submissions";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must point to a migrated temporary PostgreSQL database.");
}

async function approveSubmission(
  entityType: "PROGRAM_SUBMISSION" | "UNIVERSITY_SUBMISSION",
  submissionId: string,
) {
  await database.dataRevision.updateMany({
    where: { entityId: submissionId, entityType, fieldName: SUBMISSION_REVIEW_FIELD },
    data: { changeStatus: "APPROVED", reviewedAt: new Date() },
  });
  if (entityType === "UNIVERSITY_SUBMISSION") {
    await database.universitySubmission.update({
      where: { id: submissionId },
      data: { reviewedAt: new Date(), status: "APPROVED" },
    });
  } else {
    await database.programSubmission.update({
      where: { id: submissionId },
      data: { reviewedAt: new Date(), status: "APPROVED" },
    });
  }
}

const suffix = randomUUID().slice(0, 8);
const contributor = await database.user.create({
  data: { email: `publisher-${suffix}@example.test` },
});

try {
  const universitySubmission = await createPendingUniversitySubmission({
    countryCode: "FR",
    name: `Athenvia Publishing University ${suffix}`,
    officialWebsite: `https://university-${suffix}.example.test`,
    submittedByUserId: contributor.id,
  });
  await approveSubmission("UNIVERSITY_SUBMISSION", universitySubmission.id);
  const university = await publishApprovedUniversitySubmission(universitySubmission.id);
  assert.equal(university.outcome, "PUBLISHED");
  assert.ok(university.entityId);
  assert.equal(university.contributorUserId, contributor.id);
  assert.equal(
    (
      await database.university.findUniqueOrThrow({
        where: { id: university.entityId! },
        select: { status: true },
      })
    ).status,
    "ACTIVE",
  );
  assert.deepEqual(await publishApprovedUniversitySubmission(universitySubmission.id), university);

  const duplicateSubmission = await createPendingUniversitySubmission({
    countryCode: "FR",
    name: `Athenvia Publishing University ${suffix}`,
    officialWebsite: `https://university-${suffix}.example.test`,
    submittedByUserId: contributor.id,
  });
  await approveSubmission("UNIVERSITY_SUBMISSION", duplicateSubmission.id);
  await database.dataRevision.updateMany({
    where: {
      changeStatus: "PENDING",
      entityId: duplicateSubmission.id,
      entityType: "UNIVERSITY_SUBMISSION",
    },
    data: { changeStatus: "REJECTED", reviewedAt: new Date() },
  });
  const duplicate = await publishApprovedUniversitySubmission(duplicateSubmission.id);
  assert.equal(duplicate.outcome, "DUPLICATE");
  assert.equal(duplicate.entityId, null);

  const programSubmission = await createPendingProgramSubmission({
    degreeType: "MASTER",
    domain: "Artificial intelligence",
    name: `MSc Safe Publication ${suffix}`,
    officialUrl: `https://university-${suffix}.example.test/program`,
    submittedByUserId: contributor.id,
    universityId: university.entityId!,
    universityName: `Athenvia Publishing University ${suffix}`,
  });
  await approveSubmission("PROGRAM_SUBMISSION", programSubmission.id);
  const program = await publishApprovedProgramSubmission(programSubmission.id);
  assert.equal(program.outcome, "PUBLISHED");
  assert.ok(program.entityId);
  const storedProgram = await database.program.findUniqueOrThrow({
    where: { id: program.entityId! },
    include: { domains: true, sources: true },
  });
  assert.equal(storedProgram.status, "ACTIVE");
  assert.equal(storedProgram.domains.length, 1);
  assert.equal(storedProgram.sources.length, 1);
  assert.deepEqual(await publishApprovedProgramSubmission(programSubmission.id), program);
} finally {
  await database.$disconnect();
}
