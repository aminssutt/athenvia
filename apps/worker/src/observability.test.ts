import assert from "node:assert/strict";
import { Writable } from "node:stream";
import test from "node:test";

import { createWorkerLogger, jobCorrelationFields } from "./observability";

test("worker logs correlate jobs without serializing secrets or error messages", () => {
  let output = "";
  const destination = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = createWorkerLogger(destination, "info");
  const correlation = jobCorrelationFields("notifications", {
    attemptsMade: 1,
    id: "job-123",
    name: "deliver-notification",
  });

  logger.error(
    {
      ...correlation,
      email: "applicant@example.test",
      endpoint: "https://push.example.test/private",
      error: Object.assign(new Error("token=private-value"), {
        name: "applicant@example.test",
      }),
      outer: { inner: { token: "deep-private-value" } },
    },
    "Notification job failed",
  );

  const record = JSON.parse(output) as Record<string, unknown>;
  assert.equal(record.correlationId, "notifications:job-123");
  assert.equal(record.email, undefined);
  assert.equal(record.endpoint, undefined);
  assert.deepEqual(record.error, { name: "UnknownError" });
  assert.match(String(record.eventId), /^[0-9a-f-]{36}$/u);
  assert.doesNotMatch(output, /applicant|push\.example|private-value|deep-private-value|outer/u);
});

test("worker job attempts distinguish active processing from settled events", () => {
  const job = { attemptsMade: 1, id: "job-123", name: "deliver-notification" };
  assert.equal(jobCorrelationFields("notifications", job).attempt, 2);
  assert.equal(jobCorrelationFields("notifications", job, "settled").attempt, 1);
});
