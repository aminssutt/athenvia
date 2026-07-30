import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

import Redis from "ioredis";

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    throw new Error("REDIS_URL is required for the university submission rate-limit smoke test");
  }

  const salt = `submission-smoke-${randomUUID()}`;
  const userId = randomUUID();
  const clientAddress = `submission-smoke-${randomUUID()}`;
  process.env.UNIVERSITY_SUBMISSION_RATE_LIMIT_SALT = salt;

  const opaqueKey = (kind: "client" | "user", value: string) => {
    const digest = createHmac("sha256", salt).update(`${kind}:${value}`).digest("hex");
    return `athenvia:university-submission:${kind}:${digest}`;
  };

  const cleanup = new Redis(redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });

  try {
    const { checkUniversitySubmissionRateLimit } = await import("./rate-limit");
    const request = new Request("https://athenvia.test/api/university-submissions", {
      headers: { "x-real-ip": clientAddress },
    });

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const result = await checkUniversitySubmissionRateLimit(request, userId);
      assert.equal(result.allowed, true, `attempt ${attempt} should be allowed`);
    }

    const blocked = await checkUniversitySubmissionRateLimit(request, userId);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.remaining, 0);

    process.stdout.write("Redis smoke passed: the sixth authenticated submission was blocked.\n");
  } finally {
    await cleanup.del(opaqueKey("client", clientAddress), opaqueKey("user", userId));
    await cleanup.quit();
  }
}

void main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
