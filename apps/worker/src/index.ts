import { NotificationPayloadSchema } from "@athenvia/contracts";
import { Worker } from "bullmq";
import pino from "pino";

import type { VerificationJobData } from "./queue-contracts";
import { VERIFICATION_DEAD_LETTER_QUEUE_NAME } from "./queue-contracts";
import { attachVerificationDeadLetterRouting, createDeadLetterProcessor } from "./dead-letter";
import { allQueues, redisConnection } from "./queues";

const logger = pino({ name: "athenvia-worker" });

const notificationWorker = new Worker(
  "notifications",
  async (job) => {
    const payload = NotificationPayloadSchema.parse(job.data);

    logger.info(
      {
        jobId: job.id,
        notificationType: payload.type,
        programId: payload.programId,
        scheduledFor: payload.scheduledFor,
      },
      "Notification payload accepted by phase-zero worker",
    );
  },
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

notificationWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error }, "Notification job failed");
});

const deadLetterWorker = new Worker<VerificationJobData>(
  VERIFICATION_DEAD_LETTER_QUEUE_NAME,
  createDeadLetterProcessor(logger),
  {
    connection: redisConnection,
    concurrency: 1,
  },
);

deadLetterWorker.on("failed", (job, error) => {
  logger.error({ jobId: job?.id, error }, "Dead-letter retention job failed");
});

const deadLetterRouting = attachVerificationDeadLetterRouting(logger);

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Worker shutdown requested");
  await Promise.all([
    notificationWorker.close(),
    deadLetterWorker.close(),
    deadLetterRouting.close(),
  ]);
  await Promise.all(allQueues.map((queue) => queue.close()));
  await redisConnection.quit();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

logger.info(
  {
    queues: ["discovery", "fetch", "parse", "review", "notifications"],
  },
  "Athenvia worker is ready",
);
