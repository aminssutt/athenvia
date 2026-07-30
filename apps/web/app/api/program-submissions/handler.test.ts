import { ActiveUniversityNotFoundError } from "@athenvia/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createProgramSubmissionPostHandler } from "./handler";

import type { ProgramSubmissionRateLimit } from "./rate-limit";

const userId = "8bc96ced-a2a7-4d0b-830d-c6ed0a794d8b";
const universityId = "03a8d733-1bb6-49c6-b3dc-4cd4216300c3";
const validBody = {
  universityId,
  universityName: "Example University",
  programName: "MSc Responsible AI",
  degreeType: "MASTER",
  domain: "Artificial intelligence",
  officialUrl: "https://example.edu/responsible-ai",
} as const;

function rateLimit(allowed = true): ProgramSubmissionRateLimit {
  return {
    allowed,
    backend: "memory",
    limit: 5,
    remaining: allowed ? 4 : 0,
    resetAt: Date.now() + 60_000,
    retryAfterSeconds: 60,
  };
}

function request(body: unknown, origin = "https://athenvia.test"): Request {
  return new Request("https://athenvia.test/api/program-submissions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/program-submissions", () => {
  const dependencies = {
    authenticatedUserId: vi.fn(),
    checkRateLimit: vi.fn(),
    createSubmission: vi.fn(),
    isTrustedOrigin: vi.fn(),
    rateLimitHeaders: vi.fn(),
  };
  const handler = createProgramSubmissionPostHandler(dependencies);

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.authenticatedUserId.mockResolvedValue(userId);
    dependencies.checkRateLimit.mockResolvedValue(rateLimit());
    dependencies.createSubmission.mockResolvedValue({
      id: "25507674-5e07-4b18-9715-05ee25ef0a14",
      status: "PENDING",
    });
    dependencies.isTrustedOrigin.mockReturnValue(true);
    dependencies.rateLimitHeaders.mockReturnValue({
      "Cache-Control": "private, no-store",
      "RateLimit-Limit": "5",
    });
  });

  it("rejects an untrusted origin before reading authentication", async () => {
    dependencies.isTrustedOrigin.mockReturnValue(false);

    const response = await handler(request(validBody, "https://attacker.test"));

    expect(response.status).toBe(403);
    expect(dependencies.authenticatedUserId).not.toHaveBeenCalled();
  });

  it("requires a database-backed session", async () => {
    dependencies.authenticatedUserId.mockResolvedValue(null);

    const response = await handler(request(validBody));

    expect(response.status).toBe(401);
    expect(dependencies.checkRateLimit).not.toHaveBeenCalled();
  });

  it("rate limits the authenticated owner before parsing input", async () => {
    dependencies.checkRateLimit.mockResolvedValue(rateLimit(false));

    const response = await handler(request({ status: "APPROVED" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(dependencies.checkRateLimit).toHaveBeenCalledWith(expect.any(Request), userId);
    expect(dependencies.createSubmission).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { ...validBody, universityId: "not-a-uuid" },
    { ...validBody, domain: "Unreviewed category" },
    { ...validBody, status: "APPROVED" },
    { ...validBody, submittedByUserId: "attacker" },
  ])("rejects malformed or server-owned input", async (body) => {
    const response = await handler(request(body));

    expect(response.status).toBe(400);
    expect(dependencies.createSubmission).not.toHaveBeenCalled();
  });

  it("stores a pending record owned by the session user", async () => {
    const response = await handler(request(validBody));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(dependencies.createSubmission).toHaveBeenCalledWith({
      submittedByUserId: userId,
      universityId,
      universityName: "Example University",
      name: "MSc Responsible AI",
      degreeType: "MASTER",
      domain: "Artificial intelligence",
      officialUrl: "https://example.edu/responsible-ai",
    });
    await expect(response.json()).resolves.toEqual({
      status: "pending_review",
      submissionId: "25507674-5e07-4b18-9715-05ee25ef0a14",
    });
  });

  it("rejects missing, inactive, or mismatched universities generically", async () => {
    dependencies.createSubmission.mockRejectedValue(new ActiveUniversityNotFoundError());

    const response = await handler(request(validBody));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNIVERSITY_NOT_FOUND" },
    });
  });
});
