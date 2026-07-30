import assert from "node:assert/strict";
import test from "node:test";

import { extractSafeText, SafeTextExtractionError, type SafeTextExtractionEvent } from "./index";

test("emits content-free deterministic success and failure events", () => {
  const events: SafeTextExtractionEvent[] = [];
  const result = extractSafeText(
    { body: "<p>Private applicant text</p>", contentType: "text/html" },
    { onEvent: (event) => events.push(event) },
  );

  assert.equal(result.text, "Private applicant text");
  assert.deepEqual(events, [
    {
      format: "html",
      inputBytes: 29,
      outcome: "success",
      outputCharacters: 22,
      warnings: 0,
    },
  ]);
  assert.doesNotMatch(JSON.stringify(events), /Private|applicant/u);

  assert.throws(
    () =>
      extractSafeText(
        { body: "not a document", contentType: "application/octet-stream" },
        { onEvent: (event) => events.push(event) },
      ),
    (error) =>
      error instanceof SafeTextExtractionError &&
      error.code === "UNSUPPORTED_CONTENT_TYPE" &&
      error.retryable === false,
  );

  assert.deepEqual(events.at(-1), {
    code: "UNSUPPORTED_CONTENT_TYPE",
    format: "unknown",
    inputBytes: 14,
    outcome: "failure",
    retryable: false,
  });
});

test("marks unexpected parser failures as retryable and serializes safe fields", () => {
  const error = new SafeTextExtractionError("PARSING_FAILED", "Parser unavailable.");

  assert.equal(error.retryable, true);
  assert.deepEqual(error.toJSON(), {
    code: "PARSING_FAILED",
    details: {},
    message: "Parser unavailable.",
    retryable: true,
  });
});

test("observer failures never alter extraction", () => {
  const result = extractSafeText(
    { body: "Admissions remain open.", contentType: "text/plain" },
    {
      onEvent() {
        throw new Error("telemetry unavailable");
      },
    },
  );

  assert.equal(result.text, "Admissions remain open.");
});
