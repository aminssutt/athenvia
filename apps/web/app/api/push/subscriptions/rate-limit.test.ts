import { describe, expect, it } from "vitest";

import { InMemoryPushMutationRateLimiter } from "./rate-limit";

describe("InMemoryPushMutationRateLimiter", () => {
  it("limits each authenticated user to twenty mutations per window", () => {
    const limiter = new InMemoryPushMutationRateLimiter();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(limiter.take("client", "user", 10_000).allowed).toBe(true);
    }
    expect(limiter.take("client", "user", 10_000).allowed).toBe(false);
  });

  it("also limits a client shared by many users", () => {
    const limiter = new InMemoryPushMutationRateLimiter();

    for (let attempt = 0; attempt < 60; attempt += 1) {
      expect(limiter.take("client", `user-${attempt}`, 10_000).allowed).toBe(true);
    }
    expect(limiter.take("client", "user-61", 10_000).allowed).toBe(false);
  });

  it("opens fresh buckets after the window elapses", () => {
    const limiter = new InMemoryPushMutationRateLimiter();

    for (let attempt = 0; attempt < 21; attempt += 1) {
      limiter.take("client", "user", 10_000);
    }

    expect(limiter.take("client", "user", 620_000).allowed).toBe(true);
  });
});
