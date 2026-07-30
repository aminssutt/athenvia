import type { DefaultJobOptions } from "bullmq";

export const VERIFICATION_ATTEMPTS = 4;
export const VERIFICATION_BACKOFF_DELAY_MS = 2_000;

export const verificationJobOptions = {
  attempts: VERIFICATION_ATTEMPTS,
  backoff: {
    type: "exponential",
    delay: VERIFICATION_BACKOFF_DELAY_MS,
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 1_000,
  },
  removeOnFail: {
    age: 30 * 24 * 60 * 60,
    count: 5_000,
  },
} satisfies DefaultJobOptions;

export const deadLetterJobOptions = {
  attempts: 1,
  removeOnComplete: {
    age: 90 * 24 * 60 * 60,
    count: 10_000,
  },
  removeOnFail: {
    age: 90 * 24 * 60 * 60,
    count: 10_000,
  },
} satisfies DefaultJobOptions;

export function verificationRetryDelays() {
  return Array.from(
    { length: VERIFICATION_ATTEMPTS - 1 },
    (_, retryIndex) => VERIFICATION_BACKOFF_DELAY_MS * 2 ** retryIndex,
  );
}

export function deadLetterJobId(stage: string, sourceJobId: string) {
  const safeStage = stage.replaceAll(/[^a-zA-Z0-9_-]/g, "-");
  const safeJobId = sourceJobId.replaceAll(/[^a-zA-Z0-9_-]/g, "-");

  return `dead-${safeStage}-${safeJobId}`;
}
