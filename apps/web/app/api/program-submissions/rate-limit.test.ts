import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { FixedWindowRateLimiter } from "./rate-limit";

describe("program submission rate limiter", () => {
  it("enforces a fixed per-user limit and resets after the window", async () => {
    const limiter = new FixedWindowRateLimiter({
      keyPrefix: "test:program-submission",
      limit: 2,
      salt: "test-salt",
      windowMs: 1_000,
    });

    expect((await limiter.take("user-a", 10_000)).allowed).toBe(true);
    expect((await limiter.take("user-a", 10_100)).allowed).toBe(true);
    expect((await limiter.take("user-a", 10_200)).allowed).toBe(false);
    expect((await limiter.take("user-b", 10_200)).allowed).toBe(true);
    expect((await limiter.take("user-a", 11_001)).allowed).toBe(true);
  });

  it("keeps the in-process fallback bounded under identifier churn", async () => {
    const limiter = new FixedWindowRateLimiter({
      keyPrefix: "test:bounded-program-submission",
      limit: 1,
      salt: "test-salt",
      windowMs: 100_000,
    });

    for (let index = 0; index <= 5_000; index += 1) {
      await limiter.take(`user-${index}`, 10_000);
    }

    expect((await limiter.take("user-0", 10_001)).allowed).toBe(true);
  });
});

const redisIntegration =
  process.env.RUN_REDIS_INTEGRATION === "1" && process.env.REDIS_URL ? describe : describe.skip;

redisIntegration("program submission Redis rate limiter", () => {
  it("shares a counter between independent application instances", async () => {
    const options = {
      keyPrefix: `test:program-submission:${randomUUID()}`,
      limit: 2,
      redisUrl: process.env.REDIS_URL,
      salt: "redis-integration-salt",
      windowMs: 2_000,
    };
    const firstInstance = new FixedWindowRateLimiter(options);
    const secondInstance = new FixedWindowRateLimiter(options);

    try {
      const first = await firstInstance.take("same-user");
      const second = await secondInstance.take("same-user");
      const blocked = await firstInstance.take("same-user");

      expect(first.backend).toBe("redis");
      expect(second.backend).toBe("redis");
      expect(blocked.backend).toBe("redis");
      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(blocked.allowed).toBe(false);
    } finally {
      firstInstance.disconnect();
      secondInstance.disconnect();
    }
  });
});
