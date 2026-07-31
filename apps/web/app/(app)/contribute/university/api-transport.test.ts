import { afterEach, describe, expect, it, vi } from "vitest";

import { UniversitySubmissionRequestSchema } from "@/app/api/university-submissions/schema";

import { UNIVERSITY_SUBMISSION_ENDPOINT, universitySubmissionApiTransport } from "./api-transport";
import { MissingUniversitySubmissionSchema, submitMissingUniversity } from "./submission";

const validDraft = {
  universityName: "University of Liechtenstein",
  country: "Liechtenstein",
  officialWebsite: "https://www.uni.li/",
} as const;

function validSubmission() {
  return MissingUniversitySubmissionSchema.parse(validDraft);
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("universitySubmissionApiTransport", () => {
  it("posts JSON to the submission API and resolves a 201 to pending review", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "pending_review", submissionId: "submission-1" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitMissingUniversity(validSubmission(), universitySubmissionApiTransport),
    ).resolves.toEqual({ status: "pending_review", submissionId: "submission-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe(UNIVERSITY_SUBMISSION_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("sends a payload the strict API request schema accepts unchanged", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "pending_review", submissionId: "submission-1" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await submitMissingUniversity(validSubmission(), universitySubmissionApiTransport);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload: unknown = JSON.parse(init.body as string);
    // The API schema is .strict(): any extra key would turn the whole
    // submission into a 400. The client payload must parse as-is.
    expect(UniversitySubmissionRequestSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      universityName: "University of Liechtenstein",
      country: "Liechtenstein",
      officialWebsite: "https://www.uni.li/",
    });
  });

  it("sends a null official website when the field is left empty", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "pending_review", submissionId: "submission-1" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await submitMissingUniversity(
      MissingUniversitySubmissionSchema.parse({ ...validDraft, officialWebsite: "" }),
      universitySubmissionApiTransport,
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { officialWebsite: unknown };
    expect(payload.officialWebsite).toBeNull();
    expect(UniversitySubmissionRequestSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    { name: "signed out", status: 401, body: { error: { code: "AUTH_REQUIRED" } } },
    { name: "rate limited", status: 429, body: { error: { code: "RATE_LIMITED" } } },
    { name: "server error", status: 503, body: { error: { code: "SUBMISSION_UNAVAILABLE" } } },
  ])("maps a $name ($status) response to unavailable", async ({ status, body }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(body, status)),
    );

    await expect(
      submitMissingUniversity(validSubmission(), universitySubmissionApiTransport),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps a network failure to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(
      submitMissingUniversity(validSubmission(), universitySubmissionApiTransport),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps a 201 with an invalid payload to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "pending_review" }, 201)),
    );

    await expect(
      submitMissingUniversity(validSubmission(), universitySubmissionApiTransport),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps a 201 with a non-JSON body to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html>", { status: 201 })),
    );

    await expect(
      submitMissingUniversity(validSubmission(), universitySubmissionApiTransport),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
