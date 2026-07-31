export const WORKER_HEARTBEAT_KEY = "athenvia:health:worker:v1";
export const WORKER_HEARTBEAT_MAX_AGE_MS = 90_000;

export async function checkWorkerHeartbeat(
  readHeartbeat: (key: string) => Promise<string | null>,
  now = new Date(),
): Promise<void> {
  const heartbeat = await readHeartbeat(WORKER_HEARTBEAT_KEY);
  const heartbeatTime = heartbeat ? Date.parse(heartbeat) : Number.NaN;
  const age = now.getTime() - heartbeatTime;

  if (!Number.isFinite(heartbeatTime) || age < 0 || age > WORKER_HEARTBEAT_MAX_AGE_MS) {
    throw new Error("Worker heartbeat is unavailable.");
  }
}
