import { type Job, type Queue, QueueEvents } from "bullmq";
import type IORedis from "ioredis";
import type { Logger } from "pino";
import type { z } from "zod";

import type { VerificationJobData, VerificationStage } from "./queue-contracts";
import { verificationQueueContracts } from "./queue-contracts";
import { deadLetterJobId } from "./queue-policy";
import {
  discoveryQueue,
  fetchQueue,
  parseQueue,
  redisConnection,
  reviewQueue,
  verificationDeadLetterQueue,
} from "./queues";

type QueueEventResource = {
  events: QueueEvents;
  connection: IORedis;
};

type RouteConfiguration<DataType extends VerificationJobData> = {
  stage: VerificationStage;
  queue: Queue<DataType>;
  schema: z.ZodType<DataType>;
  deadLetterJobName: string;
};

async function routeFinalFailure<DataType extends VerificationJobData>(
  configuration: RouteConfiguration<DataType>,
  jobId: string,
  logger: Logger,
) {
  const sourceJob = await configuration.queue.getJob(jobId);

  if (!sourceJob || !(await sourceJob.isFailed())) {
    return;
  }

  const payload = configuration.schema.parse(sourceJob.data);
  const deadLetter = await verificationDeadLetterQueue.add(
    configuration.deadLetterJobName,
    payload,
    {
      jobId: deadLetterJobId(configuration.stage, jobId),
    },
  );

  await deadLetter.log(
    `Source queue=${configuration.queue.name}; sourceJobId=${jobId}; attemptsMade=${sourceJob.attemptsMade}`,
  );

  logger.error(
    {
      deadLetterJobId: deadLetter.id,
      sourceJobId: jobId,
      sourceQueue: configuration.queue.name,
      attemptsMade: sourceJob.attemptsMade,
    },
    "Verification job routed to dead-letter queue",
  );
}

function listenForFinalFailures<DataType extends VerificationJobData>(
  configuration: RouteConfiguration<DataType>,
  logger: Logger,
): QueueEventResource {
  const connection = redisConnection.duplicate();
  const events = new QueueEvents(configuration.queue.name, { connection });

  const route = ({ jobId }: { jobId: string }) => {
    void routeFinalFailure(configuration, jobId, logger).catch((error: unknown) => {
      logger.error(
        {
          error,
          sourceJobId: jobId,
          sourceQueue: configuration.queue.name,
        },
        "Unable to route final verification failure",
      );
    });
  };

  events.on("failed", route);
  events.on("retries-exhausted", route);
  events.on("error", (error) => {
    logger.error(
      { error, sourceQueue: configuration.queue.name },
      "Verification queue event listener failed",
    );
  });

  return { events, connection };
}

export function attachVerificationDeadLetterRouting(logger: Logger) {
  const resources = [
    listenForFinalFailures(
      {
        stage: "discovery",
        queue: discoveryQueue,
        schema: verificationQueueContracts.discovery.schema,
        deadLetterJobName: verificationQueueContracts.discovery.deadLetterJobName,
      },
      logger,
    ),
    listenForFinalFailures(
      {
        stage: "fetch",
        queue: fetchQueue,
        schema: verificationQueueContracts.fetch.schema,
        deadLetterJobName: verificationQueueContracts.fetch.deadLetterJobName,
      },
      logger,
    ),
    listenForFinalFailures(
      {
        stage: "parse",
        queue: parseQueue,
        schema: verificationQueueContracts.parse.schema,
        deadLetterJobName: verificationQueueContracts.parse.deadLetterJobName,
      },
      logger,
    ),
    listenForFinalFailures(
      {
        stage: "review",
        queue: reviewQueue,
        schema: verificationQueueContracts.review.schema,
        deadLetterJobName: verificationQueueContracts.review.deadLetterJobName,
      },
      logger,
    ),
  ];

  return {
    waitUntilReady: async () => {
      await Promise.all(resources.map(({ events }) => events.waitUntilReady()));
    },
    close: async () => {
      await Promise.all(resources.map(({ events }) => events.close()));
      await Promise.all(
        resources.map(async ({ connection }) => {
          if (connection.status !== "end") {
            await connection.quit();
          }
        }),
      );
    },
  };
}

export function createDeadLetterProcessor(logger: Logger) {
  return async (job: Job<VerificationJobData>) => {
    const stage = Object.entries(verificationQueueContracts).find(
      ([, contract]) => contract.deadLetterJobName === job.name,
    );

    if (!stage) {
      throw new Error(`Unsupported dead-letter job name: ${job.name}`);
    }

    const [stageName, contract] = stage;
    const payload = contract.schema.parse(job.data);
    const identifier = Object.values(payload)[0];

    logger.error(
      {
        deadLetterJobId: job.id,
        recordId: identifier,
        sourceStage: stageName,
      },
      "Verification job retained in dead-letter queue",
    );
  };
}
