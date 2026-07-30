import { describe, expect, it } from "vitest";

import { InMemorySubmissionRateLimiter } from "./rate-limit";

describe("InMemorySubmissionRateLimiter", () => {
  it("limits each authenticated user to five attempts per hour", () => {
    const limiter = new InMemorySubmissionRateLimiter();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(limiter.take("client", "user", 10_000).allowed).toBe(true);
    }
    expect(limiter.take("client", "user", 10_000).allowed).toBe(false);
  });

  it("also limits a client shared by many users", () => {
    const limiter = new InMemorySubmissionRateLimiter();

    for (let attempt = 0; attempt < 20; attempt += 1) {
      expect(limiter.take("client", `user-${attempt}`, 10_000).allowed).toBe(true);
    }
    expect(limiter.take("client", "user-21", 10_000).allowed).toBe(false);
  });

  it("opens fresh buckets after an hour", () => {
    const limiter = new InMemorySubmissionRateLimiter();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      limiter.take("client", "user", 10_000);
    }

    expect(limiter.take("client", "user", 3_610_000).allowed).toBe(true);
  });
});
