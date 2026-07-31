import assert from "node:assert/strict";
import test from "node:test";

import {
  clearWorkerHeartbeat,
  refreshWorkerHeartbeat,
  WORKER_HEARTBEAT_KEY,
  WORKER_HEARTBEAT_TTL_SECONDS,
  type WorkerHeartbeatRedis,
} from "./heartbeat";

test("worker heartbeat uses one opaque key with a bounded TTL", async () => {
  const calls: unknown[][] = [];
  const redis: WorkerHeartbeatRedis = {
    async del(...arguments_) {
      calls.push(["del", ...arguments_]);
    },
    async set(...arguments_) {
      calls.push(["set", ...arguments_]);
    },
  };
  const now = new Date("2026-07-31T10:00:00.000Z");

  await refreshWorkerHeartbeat(redis, now);
  await clearWorkerHeartbeat(redis);

  assert.deepEqual(calls, [
    ["set", WORKER_HEARTBEAT_KEY, now.toISOString(), "EX", WORKER_HEARTBEAT_TTL_SECONDS],
    ["del", WORKER_HEARTBEAT_KEY],
  ]);
});
