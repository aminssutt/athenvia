import { createHash } from "node:crypto";

import Redis from "ioredis";

const SEARCH_LIMIT = 30;
const SEARCH_WINDOW_MS = 60_000;
const REDIS_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
return { current, redis.call("PTTL", KEYS[1]) }
`;

type MemoryEntry = {
  count: number;
  resetAt: number;
};

type SearchRateLimitState = {
  memory: Map<string, MemoryEntry>;
  redis?: Redis;
};

const globalForRateLimit = globalThis as typeof globalThis & {
  athenviaSearchRateLimit?: SearchRateLimitState;
};

const state =
  globalForRateLimit.athenviaSearchRateLimit ??
  ({
    memory: new Map<string, MemoryEntry>(),
  } satisfies SearchRateLimitState);

if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.athenviaSearchRateLimit = state;
}

export type SearchRateLimit = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

function getRedis(): Redis | null {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  if (!state.redis) {
    state.redis = new Redis(redisUrl, {
      commandTimeout: 800,
      connectTimeout: 800,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    state.redis.on("error", () => {
      // A bounded in-process limiter remains active while Redis is unavailable.
    });
  }

  return state.redis;
}

function anonymizedClientKey(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address =
    request.headers.get("x-real-ip") ??
    request.headers.get("cf-connecting-ip") ??
    forwardedFor ??
    "unknown";
  const salt = process.env.SEARCH_RATE_LIMIT_SALT ?? process.env.AUTH_SECRET ?? "athenvia-search";

  return createHash("sha256").update(`${salt}:${address}`).digest("hex");
}

function resultFromCount(count: number, resetAt: number): SearchRateLimit {
  const now = Date.now();
  const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));

  return {
    allowed: count <= SEARCH_LIMIT,
    limit: SEARCH_LIMIT,
    remaining: Math.max(0, SEARCH_LIMIT - count),
    resetAt,
    retryAfterSeconds,
  };
}

async function checkRedis(key: string): Promise<SearchRateLimit | null> {
  const redis = getRedis();
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
      `athenvia:search-rate:${key}`,
      SEARCH_WINDOW_MS,
    )) as [number, number];
    const count = Number(response[0]);
    const ttl = Math.max(1, Number(response[1]));

    return resultFromCount(count, Date.now() + ttl);
  } catch {
    return null;
  }
}

function checkMemory(key: string): SearchRateLimit {
  const now = Date.now();
  const existing = state.memory.get(key);
  const entry =
    existing && existing.resetAt > now
      ? { count: existing.count + 1, resetAt: existing.resetAt }
      : { count: 1, resetAt: now + SEARCH_WINDOW_MS };

  state.memory.set(key, entry);

  if (state.memory.size > 5_000) {
    for (const [storedKey, storedEntry] of state.memory) {
      if (storedEntry.resetAt <= now) {
        state.memory.delete(storedKey);
      }
    }
  }

  return resultFromCount(entry.count, entry.resetAt);
}

export async function checkSearchRateLimit(request: Request): Promise<SearchRateLimit> {
  const key = anonymizedClientKey(request);
  return (await checkRedis(key)) ?? checkMemory(key);
}

export function searchRateLimitHeaders(rateLimit: SearchRateLimit): HeadersInit {
  return {
    "Cache-Control": "no-store",
    "RateLimit-Limit": String(rateLimit.limit),
    "RateLimit-Remaining": String(rateLimit.remaining),
    "RateLimit-Reset": String(rateLimit.retryAfterSeconds),
  };
}
