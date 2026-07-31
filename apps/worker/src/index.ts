import { Worker } from "bullmq";

import {
  dispatchDueNotificationDeliveries,
  processNotificationDeliveryJob,
  recoverStaleNotificationDeliveries,
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
import {
  clearWorkerHeartbeat,
  refreshWorkerHeartbeat,
  WORKER_HEARTBEAT_INTERVAL_MS,
} from "./heartbeat";
import { createWorkerLogger, jobCorrelationFields } from "./observability";

const logger = createWorkerLogger();

const notificationTransport = new WebPushNotificationTransport(vapidConfiguration);
const notificationWorker = new Worker<NotificationDeliveryJobData>(
  notificationDeliveryQueueContract.queueName,
  (job) =>
    processNotificationDeliveryJob(job, {
      logger: logger.child(jobCorrelationFields(notificationDeliveryQueueContract.queueName, job)),
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
  logger.error(
    {
      ...(job
        ? jobCorrelationFields(notificationDeliveryQueueContract.queueName, job, "settled")
        : {}),
      error,
      event: "worker.job_failed",
      queue: notificationDeliveryQueueContract.queueName,
    },
    "Notification delivery job failed",
  );
});

notificationWorker.on("completed", (job) => {
  logger.info(
    {
      ...jobCorrelationFields(notificationDeliveryQueueContract.queueName, job, "settled"),
      event: "worker.job_completed",
    },
    "Notification delivery job completed",
  );
});

notificationWorker.on("error", (error) => {
  logger.error(
    {
      error,
      event: "worker.queue_error",
      queue: notificationDeliveryQueueContract.queueName,
    },
    "Notification worker error",
  );
});

let dispatchTask: Promise<void> | null = null;
const dispatchDueNotifications = () => {
  if (dispatchTask !== null) {
    return dispatchTask;
  }
  dispatchTask = (async () => {
    try {
      try {
        const recovery = await recoverStaleNotificationDeliveries({
          repository: prismaNotificationDeliveryRepository,
        });
        if (recovery.quarantinedCount > 0 || recovery.recoveredCount > 0) {
          logger.info(
            {
              quarantinedCount: recovery.quarantinedCount,
              recoveredCount: recovery.recoveredCount,
              scannedCount: recovery.scannedCount,
            },
            "Stale notification claims recovered",
          );
        }
      } catch (error) {
        logger.error(
          { errorName: error instanceof Error ? error.name : "UnknownError" },
          "Notification claim recovery failed",
        );
      }

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
  logger.error(
    {
      ...(job ? jobCorrelationFields(VERIFICATION_DEAD_LETTER_QUEUE_NAME, job, "settled") : {}),
      error,
      event: "worker.job_failed",
      queue: VERIFICATION_DEAD_LETTER_QUEUE_NAME,
    },
    "Dead-letter retention job failed",
  );
});

deadLetterWorker.on("error", (error) => {
  logger.error(
    { error, event: "worker.queue_error", queue: VERIFICATION_DEAD_LETTER_QUEUE_NAME },
    "Dead-letter worker error",
  );
});

const deadLetterRouting = attachVerificationDeadLetterRouting(logger);
let heartbeatInterval: NodeJS.Timeout | null = null;
let shuttingDown = false;

const shutdown = async (signal: string) => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  logger.info({ event: "worker.shutdown", signal }, "Worker shutdown requested");
  clearInterval(dispatchInterval);
  clearInterval(reminderSweepInterval);
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
  }
  await Promise.all([dispatchTask ?? Promise.resolve(), reminderSweepTask ?? Promise.resolve()]);
  await Promise.all([
    notificationWorker.close(),
    deadLetterWorker.close(),
    deadLetterRouting.close(),
  ]);
  await Promise.all(allQueues.map((queue) => queue.close()));
  await clearWorkerHeartbeat(redisConnection).catch(() => undefined);
  await redisConnection.quit();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

process.on("uncaughtException", (error) => {
  logger.fatal({ error, event: "worker.uncaught_exception" }, "Uncaught worker exception");
  process.exit(1);
});

process.on("unhandledRejection", (error) => {
  logger.fatal({ error, event: "worker.unhandled_rejection" }, "Unhandled worker rejection");
  process.exit(1);
});

async function markWorkerReady(): Promise<void> {
  await Promise.all([
    notificationWorker.waitUntilReady(),
    deadLetterWorker.waitUntilReady(),
    deadLetterRouting.waitUntilReady(),
  ]);
  await refreshWorkerHeartbeat(redisConnection);
  heartbeatInterval = setInterval(() => {
    void refreshWorkerHeartbeat(redisConnection).catch((error: unknown) => {
      logger.error({ error, event: "worker.heartbeat_failed" }, "Worker heartbeat refresh failed");
    });
  }, WORKER_HEARTBEAT_INTERVAL_MS);
  heartbeatInterval.unref();

  logger.info(
    {
      event: "worker.ready",
      queues: ["discovery", "fetch", "parse", "review", "notifications"],
    },
    "Athenvia worker is ready",
  );
}

void markWorkerReady().catch((error: unknown) => {
  logger.fatal({ error, event: "worker.startup_failed" }, "Worker readiness failed");
  process.exit(1);
});
