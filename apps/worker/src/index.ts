import { NotificationPayloadSchema } from "@athenvia/contracts";
import { Worker } from "bullmq";
import pino from "pino";

import { redisConnection } from "./queues";

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

const shutdown = async (signal: string) => {
  logger.info({ signal }, "Worker shutdown requested");
  await notificationWorker.close();
  await redisConnection.quit();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

logger.info("Athenvia worker is ready");
