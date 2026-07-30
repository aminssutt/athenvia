import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PerDomainRateLimiter } from "./rate-limit";

describe("PerDomainRateLimiter", () => {
  it("serializes requests and applies the greater configured or robots delay", async () => {
    let now = 1_000;
    const waits: number[] = [];
    const events: string[] = [];
    const limiter = new PerDomainRateLimiter(
      500,
      () => now,
      async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      },
    );

    await limiter.schedule("www.example.edu", 2_000, async () => {
      events.push("first");
    });
    await limiter.schedule("www.example.edu", null, async () => {
      events.push("second");
    });

    assert.deepEqual(events, ["first", "second"]);
    assert.deepEqual(waits, [2_000]);
  });
});
