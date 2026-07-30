import { database } from "./client";
import { createDuplicateReview, findUniversityDuplicateCandidates } from "./duplicate-detection";

export type PendingUniversitySubmissionInput = {
  submittedByUserId: string;
  name: string;
  countryCode: string;
  officialWebsite: string | null;
};

type FindUserId = (email: string) => Promise<{ id: string } | null>;
type InsertUniversitySubmission = (
  input: PendingUniversitySubmissionInput,
) => Promise<{ id: string; status: "PENDING" }>;

const defaultFindUserId: FindUserId = (email) =>
  database.user.findUnique({
    where: { email },
    select: { id: true },
  });

const defaultInsertUniversitySubmission: InsertUniversitySubmission = (input) =>
  database.$transaction(async (transaction) => {
    const submission = await transaction.universitySubmission.create({
      data: {
        ...input,
        status: "PENDING",
      },
      select: {
        id: true,
        status: true,
      },
    });
    const candidates = await findUniversityDuplicateCandidates(input, transaction);
    await createDuplicateReview(transaction, "UNIVERSITY_SUBMISSION", submission.id, candidates);

    return { id: submission.id, status: "PENDING" };
  });

export async function findAuthenticatedUserIdByEmail(
  email: string,
  findUserId: FindUserId = defaultFindUserId,
) {
  return (await findUserId(email))?.id ?? null;
}

export async function createPendingUniversitySubmission(
  input: PendingUniversitySubmissionInput,
  insert: InsertUniversitySubmission = defaultInsertUniversitySubmission,
) {
  if (!/^[A-Z]{2}$/.test(input.countryCode)) {
    throw new Error("University submission countryCode must be ISO alpha-2");
  }

  return insert(input);
}
