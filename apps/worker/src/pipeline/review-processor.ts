import type { Logger } from "pino";

export type ReviewableRevision = {
  id: string;
  changeStatus: string;
  entityType: string;
  fieldName: string;
  hasConflict: boolean;
};

export type ReviewProcessorDependencies = {
  loadRevision: (revisionId: string) => Promise<ReviewableRevision | null>;
  logger: Logger;
};

export type ReviewProcessorResult = {
  outcome: "PENDING_ADMIN" | "ALREADY_DECIDED" | "SKIPPED";
};

/**
 * Review stage of the verification pipeline. The worker never approves a
 * revision on its own: this stage confirms the revision reached the admin
 * review queue and surfaces it in the logs. Automated approval policies plug
 * in here once they exist; until then a human decides in the admin interface.
 */
export async function processReviewJob(
  revisionId: string,
  dependencies: ReviewProcessorDependencies,
): Promise<ReviewProcessorResult> {
  const revision = await dependencies.loadRevision(revisionId);
  if (!revision) {
    dependencies.logger.warn({ event: "pipeline.review_revision_missing", revisionId });
    return { outcome: "SKIPPED" };
  }
  if (revision.changeStatus !== "PENDING") {
    dependencies.logger.info({
      changeStatus: revision.changeStatus,
      event: "pipeline.review_already_decided",
      revisionId,
    });
    return { outcome: "ALREADY_DECIDED" };
  }

  dependencies.logger.info({
    entityType: revision.entityType,
    event: "pipeline.review_pending_admin",
    fieldName: revision.fieldName,
    hasConflict: revision.hasConflict,
    revisionId,
  });
  return { outcome: "PENDING_ADMIN" };
}
