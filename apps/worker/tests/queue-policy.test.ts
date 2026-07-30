import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  deadLetterJobId,
  deadLetterJobOptions,
  VERIFICATION_ATTEMPTS,
  verificationJobOptions,
  verificationRetryDelays,
} from "../src/queue-policy";

describe("verification queue policy", () => {
  it("uses bounded exponential retries", () => {
    assert.equal(verificationJobOptions.backoff.type, "exponential");
    assert.equal(verificationJobOptions.attempts, VERIFICATION_ATTEMPTS);
    assert.deepEqual(verificationRetryDelays(), [2_000, 4_000, 8_000]);
  });

  it("retains completed, failed and dead-letter jobs with age and count caps", () => {
    assert.deepEqual(verificationJobOptions.removeOnComplete, {
      age: 86_400,
      count: 1_000,
    });
    assert.deepEqual(verificationJobOptions.removeOnFail, {
      age: 2_592_000,
      count: 5_000,
    });
    assert.deepEqual(deadLetterJobOptions.removeOnComplete, {
      age: 7_776_000,
      count: 10_000,
    });
    assert.deepEqual(deadLetterJobOptions.removeOnFail, {
      age: 7_776_000,
      count: 10_000,
    });
  });

  it("builds deterministic BullMQ-safe dead-letter IDs", () => {
    assert.equal(deadLetterJobId("fetch", "source:42/attempt"), "dead-fetch-source-42-attempt");
    assert.equal(deadLetterJobId("fetch", "42"), deadLetterJobId("fetch", "42"));
  });
});
