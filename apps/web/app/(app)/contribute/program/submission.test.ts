import { describe, expect, it, vi } from "vitest";

import {
  MissingProgramSubmissionSchema,
  submitMissingProgram,
  UniversityContextSchema,
} from "./submission";

import type { MissingProgramSubmission } from "./submission";

const validDraft = {
  universityId: "c9502eb6-819b-4723-9a17-d503555eaead",
  universityName: "National University of Singapore",
  programName: "MSc Responsible Robotics",
  degreeType: "MASTER",
  domain: "Robotics",
  officialUrl: "https://example.edu/program",
} as const;

function validSubmission(): MissingProgramSubmission {
  return MissingProgramSubmissionSchema.parse(validDraft);
}

describe("UniversityContextSchema", () => {
  it("accepts a UUID and a non-empty university name", () => {
    expect(
      UniversityContextSchema.safeParse({
        universityId: validDraft.universityId,
        universityName: validDraft.universityName,
      }).success,
    ).toBe(true);
  });

  it.each([
    { universityId: "not-a-uuid", universityName: validDraft.universityName },
    { universityId: validDraft.universityId, universityName: "" },
  ])("rejects an invalid selected-university context", (context) => {
    expect(UniversityContextSchema.safeParse(context).success).toBe(false);
  });
});

describe("MissingProgramSubmissionSchema", () => {
  it("requires the program name, degree, and approved domain", () => {
    const result = MissingProgramSubmissionSchema.safeParse({
      ...validDraft,
      programName: "",
      degreeType: "",
      domain: "",
      officialUrl: "",
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      const errors = result.error.flatten().fieldErrors;
      expect(errors.programName).toContain("Enter the program name.");
      expect(errors.degreeType).toContain("Choose a degree.");
      expect(errors.domain).toContain("Choose a domain.");
      expect(errors.officialUrl).toBeUndefined();
    }
  });

  it("rejects a domain outside the approved list", () => {
    const result = MissingProgramSubmissionSchema.safeParse({
      ...validDraft,
      domain: "Finance",
    });

    expect(result.success).toBe(false);
  });

  it.each(["https://example.edu/program", "http://example.edu/program"])(
    "accepts an HTTP(S) official URL: %s",
    (officialUrl) => {
      const result = MissingProgramSubmissionSchema.safeParse({
        ...validDraft,
        officialUrl,
      });

      expect(result.success).toBe(true);
    },
  );

  it.each(["ftp://example.edu/program", "javascript:alert(1)", "example.edu/program"])(
    "rejects a non-HTTP(S) or incomplete official URL: %s",
    (officialUrl) => {
      const result = MissingProgramSubmissionSchema.safeParse({
        ...validDraft,
        officialUrl,
      });

      expect(result.success).toBe(false);
    },
  );

  it("normalizes an empty optional URL to null", () => {
    const result = MissingProgramSubmissionSchema.parse({
      ...validDraft,
      officialUrl: "",
    });

    expect(result.officialUrl).toBeNull();
  });
});

describe("submitMissingProgram", () => {
  it("returns unavailable by default and never invents a success", async () => {
    await expect(submitMissingProgram(validSubmission())).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("accepts a valid pending-review response from an injected transport", async () => {
    const submission = validSubmission();
    const transport = vi.fn(async () => ({
      status: "pending_review",
      submissionId: "submission-123",
    }));

    await expect(submitMissingProgram(submission, transport)).resolves.toEqual({
      status: "pending_review",
      submissionId: "submission-123",
    });
    expect(transport).toHaveBeenCalledOnce();
    expect(transport).toHaveBeenCalledWith(submission);
  });

  it.each([
    { status: "pending_review" },
    { status: "accepted", submissionId: "submission-123" },
    { status: "pending_review", submissionId: "" },
  ])("maps a malformed transport response to unavailable", async (response) => {
    const transport = vi.fn(async () => response);

    await expect(submitMissingProgram(validSubmission(), transport)).resolves.toEqual({
      status: "unavailable",
    });
  });

  it("does not call the transport when the boundary input is invalid", async () => {
    const transport = vi.fn();
    const invalidSubmission = {
      ...validSubmission(),
      officialUrl: "ftp://example.edu/program",
    } as MissingProgramSubmission;

    await expect(submitMissingProgram(invalidSubmission, transport)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
