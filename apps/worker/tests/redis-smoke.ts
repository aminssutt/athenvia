import assert from "node:assert/strict";

import { Worker } from "bullmq";
import pino from "pino";

import { attachVerificationDeadLetterRouting, createDeadLetterProcessor } from "../src/dead-letter";
import {
  verificationQueueContracts,
  VERIFICATION_DEAD_LETTER_QUEUE_NAME,
} from "../src/queue-contracts";
import { deadLetterJobId, VERIFICATION_ATTEMPTS } from "../src/queue-policy";
import {
  addFetchJob,
  allQueues,
  fetchQueue,
  redisConnection,
  verificationDeadLetterQueue,
} from "../src/queues";

const logger = pino({ level: "silent" });
const sourceId = "9099972d-aa46-4677-8ab6-99d0c63b2618";

const routing = attachVerificationDeadLetterRouting(logger);
const deadLetterWorker = new Worker(
  VERIFICATION_DEAD_LETTER_QUEUE_NAME,
  createDeadLetterProcessor(logger),
  { connection: redisConnection },
);
const failingWorker = new Worker(
  verificationQueueContracts.fetch.queueName,
  async () => {
    throw new Error("Expected smoke-test failure");
  },
  { connection: redisConnection },
);

let sourceJobId: string | undefined;
let retainedJobId: string | undefined;

try {
  await Promise.all([
    routing.waitUntilReady(),
    deadLetterWorker.waitUntilReady(),
    failingWorker.waitUntilReady(),
  ]);

  const sourceJob = await addFetchJob({ sourceId });
  sourceJobId = sourceJob.id;
  assert.ok(sourceJobId);
  retainedJobId = deadLetterJobId("fetch", sourceJobId);

  const deadline = Date.now() + 30_000;
  let deadLetter = await verificationDeadLetterQueue.getJob(retainedJobId);

  while ((!deadLetter || !(await deadLetter.isCompleted())) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    deadLetter = await verificationDeadLetterQueue.getJob(retainedJobId);
  }

  assert.ok(deadLetter, "final failure was routed to the dead-letter queue");
  assert.equal(await deadLetter.isCompleted(), true);
  assert.deepEqual(deadLetter.data, { sourceId });

  const failedSource = await fetchQueue.getJob(sourceJobId);
  assert.ok(failedSource);
  assert.equal(await failedSource.isFailed(), true);
  assert.equal(failedSource.attemptsMade, VERIFICATION_ATTEMPTS);

  process.stdout.write(
    `Redis smoke passed: fetch job ${sourceJobId} exhausted ${VERIFICATION_ATTEMPTS} attempts and became ${retainedJobId}.\n`,
  );
} finally {
  if (sourceJobId) {
    await (await fetchQueue.getJob(sourceJobId))?.remove();
  }
  if (retainedJobId) {
    await (await verificationDeadLetterQueue.getJob(retainedJobId))?.remove();
  }

  await Promise.all([failingWorker.close(), deadLetterWorker.close(), routing.close()]);
  await Promise.all(allQueues.map((queue) => queue.close()));
  await redisConnection.quit();
}
