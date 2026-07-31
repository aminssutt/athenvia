import type { Prisma } from "@prisma/client";

export const SUBMISSION_REVIEW_FIELD = "submissionReview";

type SubmissionReviewClient = Pick<Prisma.TransactionClient, "dataRevision">;

/**
 * Files the pending review for a student-submitted record.
 *
 * Provenance is the submitting student, not the verification worker: the row
 * carries createdByUserId + createdByWorker: false, which satisfies the
 * data_revisions_creator_check constraint (a non-worker revision must name
 * its creator). Note the created_by_user_id foreign key is ON DELETE
 * RESTRICT (migration 20260730180000_revision_conflict_guards), so a
 * contributor's User row can no longer be hard-deleted — account removal
 * already anonymizes the row instead (see anonymizeAccount), which keeps the
 * audit trail intact.
 */
export async function createSubmissionReview(
  client: SubmissionReviewClient,
  entityType: "PROGRAM_SUBMISSION" | "UNIVERSITY_SUBMISSION",
  submissionId: string,
  submittedByUserId: string,
  proposedRecord: Prisma.InputJsonObject,
): Promise<string> {
  const revision = await client.dataRevision.create({
    data: {
      createdByUserId: submittedByUserId,
      createdByWorker: false,
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
