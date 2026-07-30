import { afterEach, describe, expect, it, vi } from "vitest";

import type { UniversitySubmissionRateLimit } from "./rate-limit";
import { UnsafeOfficialWebsiteError } from "./safe-url";
import { createUniversitySubmissionPostHandler } from "./handler";

const allowedRateLimit: UniversitySubmissionRateLimit = {
  allowed: true,
  limit: 5,
  remaining: 4,
  retryAfterSeconds: 3_600,
};

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("https://athenvia.test/api/university-submissions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://athenvia.test",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function dependencies() {
  return {
    getAuthenticatedUserId: vi.fn<() => Promise<string | null>>(
      async () => "0b5fc507-68e9-4b0e-9167-617757dcdd0e",
    ),
    checkRateLimit: vi.fn(async () => allowedRateLimit),
    validateWebsite: vi.fn(async (website: string) => new URL(website).toString()),
    createSubmission: vi.fn(async () => ({
      id: "a58be0c4-9abe-44bd-aed1-388eb603b939",
      status: "PENDING" as const,
    })),
  };
}

describe("university submission POST handler", () => {
  const initialNextAuthUrl = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (initialNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = initialNextAuthUrl;
    }
  });

  it("links a validated pending submission to the authenticated user", async () => {
    const mocks = dependencies();
    const response = await createUniversitySubmissionPostHandler(mocks)(
      request({
        universityName: "  National   University of Singapore ",
        country: "Singapore",
        officialWebsite: "https://nus.edu.sg",
      }),
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      status: "pending_review",
      submissionId: "a58be0c4-9abe-44bd-aed1-388eb603b939",
    });
    expect(mocks.createSubmission).toHaveBeenCalledWith({
      submittedByUserId: "0b5fc507-68e9-4b0e-9167-617757dcdd0e",
      name: "National University of Singapore",
      countryCode: "SG",
      officialWebsite: "https://nus.edu.sg/",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("requires an Auth.js owner before consuming the rate limit", async () => {
    const mocks = dependencies();
    mocks.getAuthenticatedUserId.mockResolvedValue(null);

    const response = await createUniversitySubmissionPostHandler(mocks)(
      request({ universityName: "Example University", country: "France" }),
    );

    expect(response.status).toBe(401);
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.createSubmission).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied owner field", async () => {
    const mocks = dependencies();
    const response = await createUniversitySubmissionPostHandler(mocks)(
      request({
        universityName: "Example University",
        country: "France",
        submittedByUserId: "attacker",
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.createSubmission).not.toHaveBeenCalled();
  });

  it("rate limits before DNS validation or persistence", async () => {
    const mocks = dependencies();
    mocks.checkRateLimit.mockResolvedValue({
      allowed: false,
      limit: 5,
      remaining: 0,
      retryAfterSeconds: 600,
    });

    const response = await createUniversitySubmissionPostHandler(mocks)(
      request({
        universityName: "Example University",
        country: "France",
        officialWebsite: "https://example.edu",
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(mocks.validateWebsite).not.toHaveBeenCalled();
    expect(mocks.createSubmission).not.toHaveBeenCalled();
  });

  it("rejects unrecognized countries and unsafe websites", async () => {
    const countryMocks = dependencies();
    const countryResponse = await createUniversitySubmissionPostHandler(countryMocks)(
      request({ universityName: "Example University", country: "Atlantis" }),
    );
    expect(countryResponse.status).toBe(400);

    const websiteMocks = dependencies();
    websiteMocks.validateWebsite.mockRejectedValue(new UnsafeOfficialWebsiteError());
    const websiteResponse = await createUniversitySubmissionPostHandler(websiteMocks)(
      request({
        universityName: "Example University",
        country: "France",
        officialWebsite: "https://localhost",
      }),
    );
    expect(websiteResponse.status).toBe(400);
    expect(websiteMocks.createSubmission).not.toHaveBeenCalled();
  });

  it("rejects cross-site JSON requests", async () => {
    const mocks = dependencies();
    const response = await createUniversitySubmissionPostHandler(mocks)(
      request(
        { universityName: "Example University", country: "France" },
        { origin: "https://attacker.test", "sec-fetch-site": "cross-site" },
      ),
    );

    expect(response.status).toBe(403);
    expect(mocks.getAuthenticatedUserId).not.toHaveBeenCalled();
  });

  it("rejects missing origins and Host-derived origins outside the configured deployment", async () => {
    const missingOriginMocks = dependencies();
    const missingOriginResponse = await createUniversitySubmissionPostHandler(missingOriginMocks)(
      request({ universityName: "Example University", country: "France" }, { origin: "" }),
    );
    expect(missingOriginResponse.status).toBe(403);
    expect(missingOriginMocks.getAuthenticatedUserId).not.toHaveBeenCalled();

    process.env.NEXTAUTH_URL = "https://app.athenvia.example";
    const spoofedHostMocks = dependencies();
    const spoofedHostResponse = await createUniversitySubmissionPostHandler(spoofedHostMocks)(
      new Request("https://attacker.test/api/university-submissions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://attacker.test",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({
          universityName: "Example University",
          country: "France",
        }),
      }),
    );
    expect(spoofedHostResponse.status).toBe(403);
    expect(spoofedHostMocks.getAuthenticatedUserId).not.toHaveBeenCalled();
  });

  it("returns a generic service error when persistence fails", async () => {
    const mocks = dependencies();
    mocks.createSubmission.mockRejectedValue(new Error("database offline"));

    const response = await createUniversitySubmissionPostHandler(mocks)(
      request({ universityName: "Example University", country: "France" }),
    );

    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("database offline");
  });
});
