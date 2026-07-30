import { createHmac, randomBytes } from "node:crypto";

import Redis from "ioredis";

const CLIENT_LIMIT = 5;
const CLIENT_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_LIMIT = 3;
const EMAIL_WINDOW_MS = 30 * 60 * 1000;
const fallbackHashSecret = randomBytes(32).toString("hex");

type Bucket = {
  count: number;
  resetAt: number;
};

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(private readonly maxBuckets = 5_000) {}

  private makeRoom(now: number) {
    if (this.buckets.size < this.maxBuckets) {
      return;
    }

    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }

    while (this.buckets.size >= this.maxBuckets) {
      const oldestKey = this.buckets.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.buckets.delete(oldestKey);
    }
  }

  take(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const existing = this.buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      this.makeRoom(now);
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }

    existing.count += 1;
    return existing.count <= limit;
  }
}

const memoryRateLimiter = new InMemoryRateLimiter();
const globalForAuthRedis = globalThis as unknown as {
  athenviaAuthRedis?: Redis;
  athenviaAuthRedisWarningShown?: boolean;
};

const redisRateLimitScript = `
  local clientCount = redis.call("INCR", KEYS[1])
  if clientCount == 1 then
    redis.call("PEXPIRE", KEYS[1], ARGV[2])
  end

  local emailCount = redis.call("INCR", KEYS[2])
  if emailCount == 1 then
    redis.call("PEXPIRE", KEYS[2], ARGV[4])
  end

  if clientCount > tonumber(ARGV[1]) or emailCount > tonumber(ARGV[3]) then
    return 0
  end
  return 1
`;

function opaqueKey(kind: "client" | "email", value: string): string {
  const secret = process.env.AUTH_SECRET ?? fallbackHashSecret;
  const digest = createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex");
  return `athenvia:auth:${kind}:${digest}`;
}

function clientAddress(request: Request): string {
  const forwardedAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (request.headers.get("x-real-ip") ?? forwardedAddress ?? "unknown").slice(0, 128);
}

function redisClient(): Redis | null {
  if (!process.env.REDIS_URL) {
    return null;
  }

  if (!globalForAuthRedis.athenviaAuthRedis) {
    const client = new Redis(process.env.REDIS_URL, {
      connectTimeout: 750,
      enableOfflineQueue: false,
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
    });
    client.on("error", () => {
      // The request path falls back to a bounded in-process limiter.
    });
    globalForAuthRedis.athenviaAuthRedis = client;
  }

  return globalForAuthRedis.athenviaAuthRedis;
}

async function takeFromRedis(clientKey: string, emailKey: string): Promise<boolean | null> {
  const client = redisClient();
  if (!client) {
    return null;
  }

  try {
    if (client.status === "wait") {
      await client.connect();
    }
    const result = await client.eval(
      redisRateLimitScript,
      2,
      clientKey,
      emailKey,
      CLIENT_LIMIT,
      CLIENT_WINDOW_MS,
      EMAIL_LIMIT,
      EMAIL_WINDOW_MS,
    );
    return result === 1;
  } catch {
    if (!globalForAuthRedis.athenviaAuthRedisWarningShown) {
      console.warn("[auth] RATE_LIMIT_REDIS_FALLBACK");
      globalForAuthRedis.athenviaAuthRedisWarningShown = true;
    }
    return null;
  }
}

export async function allowMagicLinkRequest(
  request: Request,
  normalizedEmail: string,
): Promise<boolean> {
  const clientKey = opaqueKey("client", clientAddress(request));
  const emailKey = opaqueKey("email", normalizedEmail);
  const redisResult = await takeFromRedis(clientKey, emailKey);

  if (redisResult !== null) {
    return redisResult;
  }

  const clientAllowed = memoryRateLimiter.take(clientKey, CLIENT_LIMIT, CLIENT_WINDOW_MS);
  const emailAllowed = memoryRateLimiter.take(emailKey, EMAIL_LIMIT, EMAIL_WINDOW_MS);
  return clientAllowed && emailAllowed;
}
