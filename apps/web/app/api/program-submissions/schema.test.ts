import { describe, expect, it, vi } from "vitest";

import { ProgramSubmissionRequestSchema } from "./schema";

const validSubmission = {
  universityId: "03a8d733-1bb6-49c6-b3dc-4cd4216300c3",
  universityName: "Example University",
  programName: "MSc Responsible AI",
  degreeType: "MASTER",
  domain: "Artificial intelligence",
  officialUrl: "https://example.edu/responsible-ai",
} as const;

describe("ProgramSubmissionRequestSchema", () => {
  it("trims fields and normalizes an HTTP(S) URL without fetching it", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = ProgramSubmissionRequestSchema.parse({
      ...validSubmission,
      universityName: "  Example   University  ",
      programName: "  MSc   Responsible AI  ",
      officialUrl: "https://example.edu/responsible-ai#requirements",
    });

    expect(result).toMatchObject({
      universityName: "Example University",
      programName: "MSc Responsible AI",
      officialUrl: "https://example.edu/responsible-ai#requirements",
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    "javascript:alert(1)",
    "ftp://example.edu/program",
    "https://user:secret@example.edu/program",
    "not a url",
  ])("rejects unsafe or unsupported URL syntax: %s", (officialUrl) => {
    expect(
      ProgramSubmissionRequestSchema.safeParse({
        ...validSubmission,
        officialUrl,
      }).success,
    ).toBe(false);
  });

  it.each([null, "", undefined])("normalizes an omitted URL (%s) to null", (officialUrl) => {
    const input = { ...validSubmission, officialUrl };
    if (officialUrl === undefined) {
      delete (input as { officialUrl?: unknown }).officialUrl;
    }

    expect(ProgramSubmissionRequestSchema.parse(input).officialUrl).toBeNull();
  });

  it("rejects client-owned status and owner fields", () => {
    expect(
      ProgramSubmissionRequestSchema.safeParse({
        ...validSubmission,
        status: "APPROVED",
        submittedByUserId: "attacker",
      }).success,
    ).toBe(false);
  });

  it("rejects hidden control characters in persisted names", () => {
    expect(
      ProgramSubmissionRequestSchema.safeParse({
        ...validSubmission,
        programName: "MSc\u0000Responsible AI",
      }).success,
    ).toBe(false);
  });
});
