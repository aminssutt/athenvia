import type { NotificationPayload } from "@athenvia/contracts";
import { Queue } from "bullmq";
import IORedis from "ioredis";

import { workerEnvironment } from "./config";

export const redisConnection = new IORedis(workerEnvironment.REDIS_URL, {
  maxRetriesPerRequest: null,
});

export const discoveryQueue = new Queue("discovery", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: 500,
    removeOnFail: 1_000,
  },
});

export const notificationQueue = new Queue<NotificationPayload>("notifications", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 1_000,
    removeOnFail: false,
  },
});
