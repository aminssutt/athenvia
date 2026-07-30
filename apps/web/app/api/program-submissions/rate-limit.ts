import { createHmac } from "node:crypto";

import Redis from "ioredis";

const REDIS_SCRIPT = `
local count = redis.call("INCR", KEYS[1])
if count == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return { count, redis.call("PTTL", KEYS[1]) }
`;

export const PROGRAM_SUBMISSION_RATE_LIMIT = 5;
export const PROGRAM_SUBMISSION_RATE_WINDOW_MS = 10 * 60_000;

type MemoryEntry = {
  count: number;
  resetAt: number;
};

export type ProgramSubmissionRateLimit = {
  allowed: boolean;
  backend: "memory" | "redis";
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

type FixedWindowRateLimiterOptions = {
  keyPrefix: string;
  limit: number;
  redisUrl?: string;
  salt: string;
  windowMs: number;
};

export class FixedWindowRateLimiter {
  private readonly memory = new Map<string, MemoryEntry>();
  private redis?: Redis;

  constructor(private readonly options: FixedWindowRateLimiterOptions) {}

  private redisKey(identifier: string): string {
    const digest = createHmac("sha256", this.options.salt).update(identifier).digest("hex");
    return `${this.options.keyPrefix}:${digest}`;
  }

  private result(
    count: number,
    resetAt: number,
    backend: ProgramSubmissionRateLimit["backend"],
  ): ProgramSubmissionRateLimit {
    return {
      allowed: count <= this.options.limit,
      backend,
      limit: this.options.limit,
      remaining: Math.max(0, this.options.limit - count),
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)),
    };
  }

  private getRedis(): Redis | null {
    if (!this.options.redisUrl) {
      return null;
    }

    if (!this.redis) {
      this.redis = new Redis(this.options.redisUrl, {
        commandTimeout: 800,
        connectTimeout: 800,
        enableOfflineQueue: false,
        lazyConnect: true,
        maxRetriesPerRequest: 1,
      });
      this.redis.on("error", () => {
        // A bounded in-process limiter remains available if Redis is unavailable.
      });
    }

    return this.redis;
  }

  private async takeFromRedis(identifier: string): Promise<ProgramSubmissionRateLimit | null> {
    const redis = this.getRedis();
    if (!redis) {
      return null;
    }

    try {
      if (redis.status === "wait") {
        await redis.connect();
      }

      const response = (await redis.eval(
        REDIS_SCRIPT,
        1,
        this.redisKey(identifier),
        this.options.windowMs,
      )) as [number, number];
      const count = Number(response[0]);
      const ttl = Math.max(1, Number(response[1]));
      return this.result(count, Date.now() + ttl, "redis");
    } catch {
      return null;
    }
  }

  private takeFromMemory(identifier: string, now: number): ProgramSubmissionRateLimit {
    const key = this.redisKey(identifier);
    const existing = this.memory.get(key);

    if (!existing && this.memory.size >= 5_000) {
      for (const [storedKey, storedEntry] of this.memory) {
        if (storedEntry.resetAt <= now) {
          this.memory.delete(storedKey);
        }
      }
      while (this.memory.size >= 5_000) {
        const oldestKey = this.memory.keys().next().value as string | undefined;
        if (!oldestKey) {
          break;
        }
        this.memory.delete(oldestKey);
      }
    }

    const entry =
      existing && existing.resetAt > now
        ? { count: existing.count + 1, resetAt: existing.resetAt }
        : { count: 1, resetAt: now + this.options.windowMs };

    this.memory.set(key, entry);

    return this.result(entry.count, entry.resetAt, "memory");
  }

  async take(identifier: string, now = Date.now()): Promise<ProgramSubmissionRateLimit> {
    return (await this.takeFromRedis(identifier)) ?? this.takeFromMemory(identifier, now);
  }

  disconnect(): void {
    this.redis?.disconnect();
    this.redis = undefined;
  }
}

type RateLimitGlobal = typeof globalThis & {
  athenviaProgramSubmissionRateLimiter?: FixedWindowRateLimiter;
};

const globalForRateLimit = globalThis as RateLimitGlobal;
const rateLimiter =
  globalForRateLimit.athenviaProgramSubmissionRateLimiter ??
  new FixedWindowRateLimiter({
    keyPrefix: "athenvia:program-submission",
    limit: PROGRAM_SUBMISSION_RATE_LIMIT,
    redisUrl: process.env.REDIS_URL,
    salt:
      process.env.PROGRAM_SUBMISSION_RATE_LIMIT_SALT ??
      process.env.AUTH_SECRET ??
      "athenvia-program-submission",
    windowMs: PROGRAM_SUBMISSION_RATE_WINDOW_MS,
  });

if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.athenviaProgramSubmissionRateLimiter = rateLimiter;
}

export async function checkProgramSubmissionRateLimit(
  _request: Request,
  userId: string,
): Promise<ProgramSubmissionRateLimit> {
  return rateLimiter.take(userId);
}

export function programSubmissionRateLimitHeaders(
  rateLimit: ProgramSubmissionRateLimit,
): HeadersInit {
  return {
    "Cache-Control": "private, no-store, max-age=0",
    "RateLimit-Limit": String(rateLimit.limit),
    "RateLimit-Remaining": String(rateLimit.remaining),
    "RateLimit-Reset": String(rateLimit.retryAfterSeconds),
    Vary: "Cookie",
  };
}
