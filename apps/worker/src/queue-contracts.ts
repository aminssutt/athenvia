import { z } from "zod";

const StableIdentifierSchema = z.string().uuid();

export const DiscoveryJobDataSchema = z
  .object({
    submissionId: StableIdentifierSchema,
  })
  .strict();

export const FetchJobDataSchema = z
  .object({
    sourceId: StableIdentifierSchema,
  })
  .strict();

export const ParseJobDataSchema = z
  .object({
    sourceSnapshotId: StableIdentifierSchema,
  })
  .strict();

export const ReviewJobDataSchema = z
  .object({
    revisionId: StableIdentifierSchema,
  })
  .strict();

export type DiscoveryJobData = z.infer<typeof DiscoveryJobDataSchema>;
export type FetchJobData = z.infer<typeof FetchJobDataSchema>;
export type ParseJobData = z.infer<typeof ParseJobDataSchema>;
export type ReviewJobData = z.infer<typeof ReviewJobDataSchema>;

export type VerificationJobData = DiscoveryJobData | FetchJobData | ParseJobData | ReviewJobData;

export const verificationQueueContracts = {
  discovery: {
    queueName: "discovery",
    jobName: "discover-official-source",
    deadLetterJobName: "discovery-final-failure",
    schema: DiscoveryJobDataSchema,
  },
  fetch: {
    queueName: "fetch",
    jobName: "fetch-official-source",
    deadLetterJobName: "fetch-final-failure",
    schema: FetchJobDataSchema,
  },
  parse: {
    queueName: "parse",
    jobName: "parse-source-snapshot",
    deadLetterJobName: "parse-final-failure",
    schema: ParseJobDataSchema,
  },
  review: {
    queueName: "review",
    jobName: "queue-verification-review",
    deadLetterJobName: "review-final-failure",
    schema: ReviewJobDataSchema,
  },
} as const;

export type VerificationStage = keyof typeof verificationQueueContracts;

export const VERIFICATION_DEAD_LETTER_QUEUE_NAME = "verification-dead-letter";
