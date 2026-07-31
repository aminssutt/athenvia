import Redis from "ioredis";

import { logRequestError } from "@/lib/observability";

import { checkWorkerHeartbeat } from "./check";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESPONSE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET(request: Request): Promise<Response> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    logRequestError(request, { code: "WORKER_HEALTH_REDIS_MISSING", route: "/api/health/worker" });
    return Response.json({ status: "unavailable" }, { headers: RESPONSE_HEADERS, status: 503 });
  }

  const redis = new Redis(redisUrl, {
    commandTimeout: 1_500,
    connectTimeout: 1_500,
    enableOfflineQueue: false,
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    await checkWorkerHeartbeat((key) => redis.get(key));
    return Response.json({ status: "ok" }, { headers: RESPONSE_HEADERS });
  } catch (error) {
    logRequestError(request, {
      code: "WORKER_HEARTBEAT_UNAVAILABLE",
      error,
      route: "/api/health/worker",
    });
    return Response.json({ status: "unavailable" }, { headers: RESPONSE_HEADERS, status: 503 });
  } finally {
    redis.disconnect();
  }
}
