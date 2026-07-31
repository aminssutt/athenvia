import { createHmac } from "node:crypto";

import Redis from "ioredis";

import { logOperationalWarning } from "@/lib/observability";

const USER_LIMIT = 20;
const CLIENT_LIMIT = 60;
const WINDOW_MS = 10 * 60 * 1_000;
const MAX_MEMORY_BUCKETS = 10_000;

const REDIS_SCRIPT = `
local clientCount = redis.call("INCR", KEYS[1])
if clientCount == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local userCount = redis.call("INCR", KEYS[2])
if userCount == 1 then
  redis.call("PEXPIRE", KEYS[2], ARGV[1])
end
return {
  clientCount,
  redis.call("PTTL", KEYS[1]),
  userCount,
  redis.call("PTTL", KEYS[2])
}
`;

type Bucket = {
  count: number;
  resetAt: number;
};

export type PushSubscriptionRateLimit = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

export class InMemoryPushMutationRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maximumBuckets = MAX_MEMORY_BUCKETS) {}

  private increment(key: string, now: number) {
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      this.makeRoom(now);
      const fresh = { count: 1, resetAt: now + WINDOW_MS };
      this.buckets.set(key, fresh);
      return fresh;
    }

    current.count += 1;
    return current;
  }

  private makeRoom(now: number) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }

    while (this.buckets.size >= this.maximumBuckets) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.buckets.delete(oldestKey);
    }
  }

  take(clientKey: string, userKey: string, now = Date.now()): PushSubscriptionRateLimit {
    const client = this.increment(clientKey, now);
    const user = this.increment(userKey, now);
    return rateLimitResult(client.count, client.resetAt - now, user.count, user.resetAt - now);
  }
}

type RateLimitState = {
  memory: InMemoryPushMutationRateLimiter;
  redis?: Redis;
  warnedAboutFallback?: boolean;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  athenviaPushSubscriptionRateLimit?: RateLimitState;
};

const state =
  globalForRateLimit.athenviaPushSubscriptionRateLimit ??
  ({ memory: new InMemoryPushMutationRateLimiter() } satisfies RateLimitState);

if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.athenviaPushSubscriptionRateLimit = state;
}

function rateLimitResult(
  clientCount: number,
  clientTtlMs: number,
  userCount: number,
  userTtlMs: number,
): PushSubscriptionRateLimit {
  const clientRemaining = Math.max(0, CLIENT_LIMIT - clientCount);
  const userRemaining = Math.max(0, USER_LIMIT - userCount);
  const retryAfterSeconds = Math.max(1, Math.ceil(Math.max(clientTtlMs, userTtlMs) / 1_000));

  return {
    allowed: clientCount <= CLIENT_LIMIT && userCount <= USER_LIMIT,
    limit: USER_LIMIT,
    remaining: Math.min(clientRemaining, userRemaining),
    retryAfterSeconds,
  };
}

function opaqueKey(kind: "client" | "user", value: string) {
  const secret =
    process.env.PUSH_SUBSCRIPTION_RATE_LIMIT_SALT ??
    process.env.AUTH_SECRET ??
    "athenvia-push-development";
  const digest = createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
  return `athenvia:push-subscription:${kind}:${digest}`;
}

function clientAddress(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    forwarded ??
    "unknown"
  ).slice(0, 128);
}

function redisClient() {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!state.redis) {
    state.redis = new Redis(process.env.REDIS_URL, {
      commandTimeout: 800,
      connectTimeout: 800,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    state.redis.on("error", () => {
      // A bounded local limiter stays active if Redis is temporarily unavailable.
    });
  }

  return state.redis;
}

async function takeFromRedis(
  clientKey: string,
  userKey: string,
): Promise<PushSubscriptionRateLimit | null> {
  const redis = redisClient();
  if (!redis) {
    return null;
  }

  try {
    if (redis.status === "wait") {
      await redis.connect();
    }

    const result = (await redis.eval(REDIS_SCRIPT, 2, clientKey, userKey, WINDOW_MS)) as [
      number,
      number,
      number,
      number,
    ];

    return rateLimitResult(
      Number(result[0]),
      Math.max(1, Number(result[1])),
      Number(result[2]),
      Math.max(1, Number(result[3])),
    );
  } catch {
    if (!state.warnedAboutFallback) {
      logOperationalWarning("push-subscription-rate-limit", "RATE_LIMIT_REDIS_FALLBACK");
      state.warnedAboutFallback = true;
    }
    return null;
  }
}

export async function checkPushSubscriptionRateLimit(
  request: Request,
  userId: string,
): Promise<PushSubscriptionRateLimit> {
  const clientKey = opaqueKey("client", clientAddress(request));
  const userKey = opaqueKey("user", userId);
  return (await takeFromRedis(clientKey, userKey)) ?? state.memory.take(clientKey, userKey);
}

export function pushSubscriptionRateLimitHeaders(
  rateLimit: PushSubscriptionRateLimit,
): Record<string, string> {
  return {
    "RateLimit-Limit": String(rateLimit.limit),
    "RateLimit-Remaining": String(rateLimit.remaining),
    "RateLimit-Reset": String(rateLimit.retryAfterSeconds),
    "Retry-After": String(rateLimit.retryAfterSeconds),
  };
}
