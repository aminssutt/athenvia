export const WORKER_HEARTBEAT_INTERVAL_MS = 30_000;
export const WORKER_HEARTBEAT_KEY = "athenvia:health:worker:v1";
export const WORKER_HEARTBEAT_TTL_SECONDS = 90;

export type WorkerHeartbeatRedis = {
  del(key: string): Promise<unknown>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
};

export async function refreshWorkerHeartbeat(
  redis: WorkerHeartbeatRedis,
  now = new Date(),
): Promise<void> {
  await redis.set(WORKER_HEARTBEAT_KEY, now.toISOString(), "EX", WORKER_HEARTBEAT_TTL_SECONDS);
}

export async function clearWorkerHeartbeat(redis: WorkerHeartbeatRedis): Promise<void> {
  await redis.del(WORKER_HEARTBEAT_KEY);
}
