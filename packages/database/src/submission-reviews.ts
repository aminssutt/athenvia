import type { Prisma } from "@prisma/client";

export const SUBMISSION_REVIEW_FIELD = "submissionReview";

type SubmissionReviewClient = Pick<Prisma.TransactionClient, "dataRevision">;

export async function createSubmissionReview(
  client: SubmissionReviewClient,
  entityType: "PROGRAM_SUBMISSION" | "UNIVERSITY_SUBMISSION",
  submissionId: string,
  submittedByUserId: string,
  proposedRecord: Prisma.InputJsonObject,
): Promise<string> {
  const revision = await client.dataRevision.create({
    data: {
      createdByWorker: true,
      entityId: submissionId,
      entityType,
      fieldName: SUBMISSION_REVIEW_FIELD,
      newValue: {
        proposedRecord,
        submittedByUserId,
      },
    },
    select: { id: true },
  });
  return revision.id;
}
