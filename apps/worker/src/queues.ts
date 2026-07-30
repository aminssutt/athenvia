import type { NotificationPayload } from "@athenvia/contracts";
import { Queue } from "bullmq";
import IORedis from "ioredis";

import { workerEnvironment } from "./config";
import {
  type DiscoveryJobData,
  type FetchJobData,
  type ParseJobData,
  type ReviewJobData,
  type VerificationJobData,
  VERIFICATION_DEAD_LETTER_QUEUE_NAME,
  verificationQueueContracts,
} from "./queue-contracts";
import { deadLetterJobOptions, verificationJobOptions } from "./queue-policy";

export const redisConnection = new IORedis(workerEnvironment.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const discoveryQueue = new Queue<DiscoveryJobData>(
  verificationQueueContracts.discovery.queueName,
  {
    connection: redisConnection,
    defaultJobOptions: verificationJobOptions,
  },
);

export const fetchQueue = new Queue<FetchJobData>(verificationQueueContracts.fetch.queueName, {
  connection: redisConnection,
  defaultJobOptions: verificationJobOptions,
});

export const parseQueue = new Queue<ParseJobData>(verificationQueueContracts.parse.queueName, {
  connection: redisConnection,
  defaultJobOptions: verificationJobOptions,
});

export const reviewQueue = new Queue<ReviewJobData>(verificationQueueContracts.review.queueName, {
  connection: redisConnection,
  defaultJobOptions: verificationJobOptions,
});

export const verificationDeadLetterQueue = new Queue<VerificationJobData>(
  VERIFICATION_DEAD_LETTER_QUEUE_NAME,
  {
    connection: redisConnection,
    defaultJobOptions: deadLetterJobOptions,
  },
);

export const notificationQueue = new Queue<NotificationPayload>("notifications", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1_000,
    removeOnFail: false,
  },
});

export function addDiscoveryJob(data: unknown) {
  return discoveryQueue.add(
    verificationQueueContracts.discovery.jobName,
    verificationQueueContracts.discovery.schema.parse(data),
  );
}

export function addFetchJob(data: unknown) {
  return fetchQueue.add(
    verificationQueueContracts.fetch.jobName,
    verificationQueueContracts.fetch.schema.parse(data),
  );
}

export function addParseJob(data: unknown) {
  return parseQueue.add(
    verificationQueueContracts.parse.jobName,
    verificationQueueContracts.parse.schema.parse(data),
  );
}

export function addReviewJob(data: unknown) {
  return reviewQueue.add(
    verificationQueueContracts.review.jobName,
    verificationQueueContracts.review.schema.parse(data),
  );
}

export const allQueues = [
  discoveryQueue,
  fetchQueue,
  parseQueue,
  reviewQueue,
  verificationDeadLetterQueue,
  notificationQueue,
] as const;
