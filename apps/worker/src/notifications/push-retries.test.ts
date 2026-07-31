import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PushEndpointResolutionError, UnsafePushEndpointError } from "../push-endpoint-safety";
import {
  classifyWebPushFailure,
  deliverWebPushWithRetry,
  MAX_WEB_PUSH_ATTEMPTS,
  WEB_PUSH_RETRY_DELAYS_MILLISECONDS,
} from "./push-retries";

describe("Web Push failure classification", () => {
  it("revokes only the permanent invalid-subscription responses", () => {
    for (const statusCode of [404, 410]) {
      assert.equal(classifyWebPushFailure({ statusCode }), "INVALID_SUBSCRIPTION");
    }
  });

  it("retries only explicit temporary HTTP responses", () => {
    for (const statusCode of [408, 425, 429, 500, 503, 599]) {
      assert.equal(classifyWebPushFailure({ statusCode }), "TRANSIENT");
    }
    for (const statusCode of [400, 401, 403, 409, 413]) {
      assert.equal(classifyWebPushFailure({ statusCode }), "PERMANENT");
    }
  });

  it("revokes subscriptions whose endpoint resolved to a non-public address", () => {
    assert.equal(classifyWebPushFailure(new UnsafePushEndpointError()), "INVALID_SUBSCRIPTION");
  });

  it("retries safely when the endpoint hostname could not be resolved", () => {
    assert.equal(classifyWebPushFailure(new PushEndpointResolutionError()), "TRANSIENT");
  });

  it("treats response-less and malformed errors as indeterminate", () => {
    for (const error of [
      new Error("Socket timeout with private endpoint details"),
      null,
      { statusCode: "503" },
      { statusCode: 999 },
    ]) {
      assert.equal(classifyWebPushFailure(error), "INDETERMINATE");
    }
  });
});

describe("bounded Web Push retries", () => {
  it("backs off for two temporary failures and then succeeds", async () => {
    const delays: number[] = [];
    let calls = 0;
    const outcome = await deliverWebPushWithRetry(
      async () => {
        calls += 1;
        if (calls < MAX_WEB_PUSH_ATTEMPTS) {
          throw { statusCode: 503 };
        }
      },
      async (delay) => {
        delays.push(delay);
      },
    );

    assert.deepEqual(outcome, { attempts: 3, kind: "SENT" });
    assert.deepEqual(delays, [...WEB_PUSH_RETRY_DELAYS_MILLISECONDS]);
  });

  it("stops after exactly three temporary attempts", async () => {
    const delays: number[] = [];
    let calls = 0;
    const outcome = await deliverWebPushWithRetry(
      async () => {
        calls += 1;
        throw { statusCode: 429 };
      },
      async (delay) => {
        delays.push(delay);
      },
    );

    assert.deepEqual(outcome, { attempts: 3, kind: "TRANSIENT" });
    assert.equal(calls, MAX_WEB_PUSH_ATTEMPTS);
    assert.deepEqual(delays, [...WEB_PUSH_RETRY_DELAYS_MILLISECONDS]);
  });

  it("never retries invalid, permanent, or indeterminate failures", async () => {
    for (const error of [{ statusCode: 410 }, { statusCode: 400 }, new Error("timeout")]) {
      let calls = 0;
      let sleeps = 0;
      const outcome = await deliverWebPushWithRetry(
        async () => {
          calls += 1;
          throw error;
        },
        async () => {
          sleeps += 1;
        },
      );
      assert.equal(calls, 1);
      assert.equal(sleeps, 0);
      assert.notEqual(outcome.kind, "SENT");
    }
  });
});
