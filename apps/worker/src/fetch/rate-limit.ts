type Delay = (milliseconds: number) => Promise<void>;

const defaultDelay: Delay = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

export class PerDomainRateLimiter {
  private readonly nextAllowedAt = new Map<string, number>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(
    private readonly minimumIntervalMs: number,
    private readonly now: () => number = Date.now,
    private readonly delay: Delay = defaultDelay,
  ) {}

  async schedule<T>(hostname: string, intervalMs: number | null, operation: () => Promise<T>) {
    const previous = this.tails.get(hostname) ?? Promise.resolve();
    let release = () => {};
    const slot = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => {}).then(() => slot);
    this.tails.set(hostname, tail);

    await previous.catch(() => {});

    try {
      const waitFor = Math.max(0, (this.nextAllowedAt.get(hostname) ?? 0) - this.now());
      if (waitFor > 0) {
        await this.delay(waitFor);
      }

      this.nextAllowedAt.set(
        hostname,
        this.now() + Math.max(this.minimumIntervalMs, intervalMs ?? 0),
      );
      return await operation();
    } finally {
      release();
      if (this.tails.get(hostname) === tail) {
        this.tails.delete(hostname);
      }
    }
  }
}
