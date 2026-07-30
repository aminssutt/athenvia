import { describe, expect, it } from "vitest";

import { InMemoryRateLimiter } from "./auth-rate-limit";

describe("InMemoryRateLimiter", () => {
  it("allows only the configured number of requests in a window", () => {
    const limiter = new InMemoryRateLimiter();

    expect(limiter.take("email:test", 2, 1_000, 10_000)).toBe(true);
    expect(limiter.take("email:test", 2, 1_000, 10_100)).toBe(true);
    expect(limiter.take("email:test", 2, 1_000, 10_200)).toBe(false);
  });

  it("starts a fresh bucket after the window expires", () => {
    const limiter = new InMemoryRateLimiter();

    expect(limiter.take("client:test", 1, 1_000, 10_000)).toBe(true);
    expect(limiter.take("client:test", 1, 1_000, 10_500)).toBe(false);
    expect(limiter.take("client:test", 1, 1_000, 11_000)).toBe(true);
  });

  it("keeps the local fallback bounded", () => {
    const limiter = new InMemoryRateLimiter(2);

    expect(limiter.take("client:one", 1, 10_000, 10_000)).toBe(true);
    expect(limiter.take("client:two", 1, 10_000, 10_000)).toBe(true);
    expect(limiter.take("client:three", 1, 10_000, 10_000)).toBe(true);
    expect(limiter.take("client:one", 1, 10_000, 10_100)).toBe(true);
  });
});
