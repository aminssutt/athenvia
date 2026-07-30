import { Worker } from "bullmq";
import pino from "pino";

import {
  dispatchDueNotificationDeliveries,
  processNotificationDeliveryJob,
  prismaClaimedNotificationPreparer,
  prismaNotificationDeliveryRepository,
} from "./notification-delivery";
import { runReminderScheduleSweep } from "./notifications";
import type { VerificationJobData } from "./queue-contracts";
import {
  notificationDeliveryQueueContract,
  type NotificationDeliveryJobData,
  VERIFICATION_DEAD_LETTER_QUEUE_NAME,
} from "./queue-contracts";
import { attachVerificationDeadLetterRouting, createDeadLetterProcessor } from "./dead-letter";
import { allQueues, redisConnection } from "./queues";
import { notificationQueue } from "./queues";
import { vapidConfiguration } from "./config";
import { WebPushNotificationTransport } from "./web-push-transport";

const logger = pino({ name: "athenvia-worker" });

const notificationTransport = new WebPushNotificationTransport(vapidConfiguration);
const notificationWorker = new Worker<NotificationDeliveryJobData>(
  notificationDeliveryQueueContract.queueName,
  (job) =>
    processNotificationDeliveryJob(job, {
      logger,
      preparer: prismaClaimedNotificationPreparer,
      repository: prismaNotificationDeliveryRepository,
      transport: notificationTransport,
    }),
  {
    connection: redisConnection,
    concurrency: 5,
  },
);

notificationWorker.on("failed", (job, error) => {
  logger.error({ errorName: error.name, jobId: job?.id }, "Notification delivery job failed");
});

let dispatchTask: Promise<void> | null = null;
const dispatchDueNotifications = () => {
  if (dispatchTask !== null) {
    return dispatchTask;
  }
  dispatchTask = (async () => {
    try {
      const result = await dispatchDueNotificationDeliveries({
        queue: notificationQueue,
        repository: prismaNotificationDeliveryRepository,
      });
      if (result.queuedCount > 0) {
        logger.info({ queuedCount: result.queuedCount }, "Due notifications dispatched");
      }
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Notification dispatcher failed",
      );
    } finally {
      dispatchTask = null;
    }
  })();
  return dispatchTask;
};
const dispatchInterval = setInterval(() => void dispatchDueNotifications(), 30_000);
dispatchInterval.unref();
void dispatchDueNotifications();

let reminderSweepTask: Promise<void> | null = null;
const sweepReminderSchedules = () => {
  if (reminderSweepTask !== null) {
    return reminderSweepTask;
  }
  reminderSweepTask = (async () => {
    try {
      const result = await runReminderScheduleSweep();
      logger.info(
        {
          created: result.reconciliation.created,
          planned: result.planned,
          rescheduled: result.reconciliation.rescheduled,
          watchlists: result.watchlists,
        },
        "Reminder schedule safety sweep completed",
      );
    } catch (error) {
      logger.error(
        { errorName: error instanceof Error ? error.name : "UnknownError" },
        "Reminder schedule safety sweep failed",
      );
    } finally {
      reminderSweepTask = null;
    }
  })();
  return reminderSweepTask;
};
const reminderSweepInterval = setInterval(() => void sweepReminderSchedules(), 5 * 60_000);
reminderSweepInterval.unref();
void sweepReminderSchedules();

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
  clearInterval(dispatchInterval);
  clearInterval(reminderSweepInterval);
  await Promise.all([dispatchTask ?? Promise.resolve(), reminderSweepTask ?? Promise.resolve()]);
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
