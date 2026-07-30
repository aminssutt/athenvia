const DEFAULT_TIMEOUT_MS = 3_000;

export type HealthDependencies = {
  checkDatabase(): Promise<unknown>;
  checkRedis(): Promise<unknown>;
};

export async function checkHealth(
  dependencies: HealthDependencies,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      Promise.all([dependencies.checkDatabase(), dependencies.checkRedis()]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Health check timed out.")), timeoutMs);
        timeout.unref();
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
