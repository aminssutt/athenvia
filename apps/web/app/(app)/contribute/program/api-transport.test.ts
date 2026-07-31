import { afterEach, describe, expect, it, vi } from "vitest";

import { ProgramSubmissionRequestSchema } from "@/app/api/program-submissions/schema";

import { PROGRAM_SUBMISSION_ENDPOINT, programSubmissionApiTransport } from "./api-transport";
import { MissingProgramSubmissionSchema, submitMissingProgram } from "./submission";

const validDraft = {
  universityId: "c9502eb6-819b-4723-9a17-d503555eaead",
  universityName: "National University of Singapore",
  programName: "MSc Responsible Robotics",
  degreeType: "MASTER",
  domain: "Robotics",
  officialUrl: "https://example.edu/program",
} as const;

function validSubmission() {
  return MissingProgramSubmissionSchema.parse(validDraft);
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

describe("programSubmissionApiTransport", () => {
  it("posts JSON to the submission API and resolves a 201 to pending review", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "pending_review", submissionId: "submission-1" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      submitMissingProgram(validSubmission(), programSubmissionApiTransport),
    ).resolves.toEqual({ status: "pending_review", submissionId: "submission-1" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe(PROGRAM_SUBMISSION_ENDPOINT);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toEqual({ "content-type": "application/json" });
  });

  it("sends a payload the strict API request schema accepts unchanged", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "pending_review", submissionId: "submission-1" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await submitMissingProgram(validSubmission(), programSubmissionApiTransport);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload: unknown = JSON.parse(init.body as string);
    // The API schema is .strict(): any extra key would turn the whole
    // submission into a 400. The client payload must parse as-is.
    expect(ProgramSubmissionRequestSchema.safeParse(payload).success).toBe(true);
    expect(payload).toEqual({
      universityId: validDraft.universityId,
      universityName: validDraft.universityName,
      programName: validDraft.programName,
      degreeType: "MASTER",
      domain: "Robotics",
      officialUrl: "https://example.edu/program",
    });
  });

  it("sends a null official URL when the field is left empty", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ status: "pending_review", submissionId: "submission-1" }, 201),
    );
    vi.stubGlobal("fetch", fetchMock);

    await submitMissingProgram(
      MissingProgramSubmissionSchema.parse({ ...validDraft, officialUrl: "" }),
      programSubmissionApiTransport,
    );

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(init.body as string) as { officialUrl: unknown };
    expect(payload.officialUrl).toBeNull();
    expect(ProgramSubmissionRequestSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    { name: "signed out", status: 401, body: { error: { code: "UNAUTHORIZED" } } },
    { name: "rate limited", status: 429, body: { error: { code: "RATE_LIMITED" } } },
    { name: "unknown university", status: 404, body: { error: { code: "UNIVERSITY_NOT_FOUND" } } },
    { name: "server error", status: 503, body: { error: { code: "SUBMISSION_UNAVAILABLE" } } },
  ])("maps a $name ($status) response to unavailable", async ({ status, body }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(body, status)),
    );

    await expect(
      submitMissingProgram(validSubmission(), programSubmissionApiTransport),
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
      submitMissingProgram(validSubmission(), programSubmissionApiTransport),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps a 201 with an invalid payload to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "pending_review" }, 201)),
    );

    await expect(
      submitMissingProgram(validSubmission(), programSubmissionApiTransport),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("maps a 201 with a non-JSON body to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<!doctype html>", { status: 201 })),
    );

    await expect(
      submitMissingProgram(validSubmission(), programSubmissionApiTransport),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
