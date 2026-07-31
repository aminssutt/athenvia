import { database } from "@athenvia/database";
import Redis from "ioredis";
import { NextResponse } from "next/server";

import { logRequestError } from "@/lib/observability";

import { checkHealth } from "./check";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const responseHeaders = {
  "Cache-Control": "no-store",
};

async function checkRedis(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is not configured.");
  }

  const redis = new Redis(redisUrl, {
    connectTimeout: 1_500,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    await redis.ping();
  } finally {
    redis.disconnect();
  }
}

export async function GET(request = new Request("http://localhost/api/health")) {
  try {
    await checkHealth({
      checkDatabase: () => database.$queryRaw`SELECT 1`,
      checkRedis,
    });

    return NextResponse.json({ status: "ok" }, { headers: responseHeaders });
  } catch (error) {
    logRequestError(request, {
      code: "WEB_HEALTH_DEPENDENCY_UNAVAILABLE",
      error,
      route: "/api/health",
    });
    return NextResponse.json(
      { status: "unavailable" },
      {
        headers: responseHeaders,
        status: 503,
      },
    );
  }
}
