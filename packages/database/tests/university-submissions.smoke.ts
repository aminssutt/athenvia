import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import {
  createPendingUniversitySubmission,
  database,
  findAuthenticatedUserIdByEmail,
} from "../src/index";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the university submission smoke test");
}

const suffix = randomUUID();
const email = `submission-smoke-${suffix}@example.test`;
let userId: string | undefined;

try {
  const user = await database.user.create({ data: { email } });
  userId = user.id;

  const ownerId = await findAuthenticatedUserIdByEmail(email);
  assert.equal(ownerId, user.id);

  const created = await createPendingUniversitySubmission({
    submittedByUserId: user.id,
    name: `University Submission Smoke ${suffix}`,
    countryCode: "SG",
    officialWebsite: "https://nus.edu.sg/",
  });

  const stored = await database.universitySubmission.findUniqueOrThrow({
    where: { id: created.id },
  });

  assert.equal(stored.submittedByUserId, user.id);
  assert.equal(stored.status, "PENDING");
  assert.equal(stored.countryCode, "SG");
  assert.equal(stored.officialWebsite, "https://nus.edu.sg/");

  process.stdout.write(
    `PostgreSQL smoke passed: pending submission ${stored.id} belongs to Auth.js user ${user.id}.\n`,
  );
} finally {
  if (userId) {
    await database.user.delete({ where: { id: userId } });
  }
  await database.$disconnect();
}
