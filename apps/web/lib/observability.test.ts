import { Writable } from "node:stream";

import { describe, expect, it } from "vitest";

import { createWebLogger } from "./observability";

describe("web structured logging", () => {
  it("drops unapproved fields recursively and serializes only a safe error name", () => {
    let output = "";
    const destination = new Writable({
      write(chunk, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = createWebLogger(destination, "info");

    logger.error(
      {
        email: "applicant@example.test",
        error: Object.assign(new Error("private applicant data"), {
          name: "applicant@example.test",
        }),
        outer: { inner: { token: "deep-private-value" } },
        password: "not-for-logs",
        requestId: "018f5c42-77e0-7b4a-9a3d-8b66e7e5a111",
      },
      "Safe failure summary",
    );

    const record = JSON.parse(output) as Record<string, unknown>;
    expect(record).toMatchObject({
      error: { name: "UnknownError" },
      message: "Safe failure summary",
      requestId: "018f5c42-77e0-7b4a-9a3d-8b66e7e5a111",
      service: "athenvia-web",
    });
    expect(record.eventId).toMatch(/^[0-9a-f-]{36}$/u);
    expect(output).not.toMatch(
      /applicant|not-for-logs|private applicant data|deep-private-value|outer/u,
    );
  });
});
