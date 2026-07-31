import { Writable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as PinoModule from "pino";

const CANARY = "private-health-canary";

const capturedLogs = vi.hoisted(() => ({ output: "" }));
const redis = vi.hoisted(() => ({
  connect: vi.fn(),
  constructor: vi.fn(),
  disconnect: vi.fn(),
  get: vi.fn(),
}));

vi.mock("pino", async (importOriginal) => {
  const actual = await importOriginal<typeof PinoModule>();
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      capturedLogs.output += chunk.toString();
      callback();
    },
  });
  const realPino = actual.pino;
  const testPino = Object.assign(
    (options: Parameters<typeof realPino>[0]) =>
      realPino({ ...options, level: "info" }, destination),
    realPino,
  );

  return { ...actual, default: testPino };
});

vi.mock("ioredis", () => {
  class RedisMock {
    readonly connect = redis.connect;
    readonly disconnect = redis.disconnect;
    readonly get = redis.get;

    constructor(...arguments_: unknown[]) {
      redis.constructor(...arguments_);
    }
  }

  return { default: RedisMock };
});

import { GET } from "./route";

function request(): Request {
  return new Request("https://athenvia.test/api/health/worker", {
    headers: { "x-health-canary": CANARY },
  });
}

function logRecords(): Array<Record<string, unknown>> {
  return capturedLogs.output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("worker health route", () => {
  beforeEach(() => {
    capturedLogs.output = "";
    vi.clearAllMocks();
    vi.stubEnv("REDIS_URL", "redis://redis.test:6379");
    redis.connect.mockResolvedValue(undefined);
    redis.get.mockResolvedValue(new Date().toISOString());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 200 when Redis contains a fresh worker heartbeat", async () => {
    const response = await GET(request());

    await expect(response.json()).resolves.toEqual({ status: "ok" });
    expect(response.status).toBe(200);
    expect(redis.connect).toHaveBeenCalledOnce();
    expect(redis.get).toHaveBeenCalledWith("athenvia:health:worker:v1");
    expect(redis.disconnect).toHaveBeenCalledOnce();
    expect(capturedLogs.output).toBe("");
  });

  it("returns a generic 503 and a safe log when the heartbeat is absent", async () => {
    redis.get.mockResolvedValue(null);

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(logRecords()).toEqual([
      expect.objectContaining({
        code: "WORKER_HEARTBEAT_UNAVAILABLE",
        error: { name: "Error" },
        event: "web.request_failed",
        route: "/api/health/worker",
      }),
    ]);
    expect(capturedLogs.output).not.toContain(CANARY);
    expect(redis.disconnect).toHaveBeenCalledOnce();
  });

  it("returns a generic 503 without leaking a Redis failure", async () => {
    redis.connect.mockRejectedValue(new Error(`Redis unavailable: ${CANARY}`));

    const response = await GET(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ status: "unavailable" });
    expect(JSON.stringify(body)).not.toContain(CANARY);
    expect(logRecords()).toEqual([
      expect.objectContaining({
        code: "WORKER_HEARTBEAT_UNAVAILABLE",
        error: { name: "Error" },
        event: "web.request_failed",
        route: "/api/health/worker",
      }),
    ]);
    expect(capturedLogs.output).not.toContain(CANARY);
    expect(redis.get).not.toHaveBeenCalled();
    expect(redis.disconnect).toHaveBeenCalledOnce();
  });
});
