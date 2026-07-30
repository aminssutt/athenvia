import { database } from "./client";

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

const defaultInsertUniversitySubmission: InsertUniversitySubmission = async (input) => {
  const submission = await database.universitySubmission.create({
    data: {
      ...input,
      status: "PENDING",
    },
    select: {
      id: true,
      status: true,
    },
  });

  return { id: submission.id, status: "PENDING" };
};

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
