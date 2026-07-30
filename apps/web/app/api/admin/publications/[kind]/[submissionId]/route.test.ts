import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishProgram, publishUniversity, resolveAdminAccess, trustedWrite } = vi.hoisted(() => ({
  publishProgram: vi.fn(),
  publishUniversity: vi.fn(),
  resolveAdminAccess: vi.fn(),
  trustedWrite: vi.fn(),
}));

vi.mock("@athenvia/database", () => ({
  ApprovedSubmissionNotFoundError: class ApprovedSubmissionNotFoundError extends Error {},
  SubmissionReviewRequiredError: class SubmissionReviewRequiredError extends Error {},
  publishApprovedProgramSubmission: publishProgram,
  publishApprovedUniversitySubmission: publishUniversity,
}));
vi.mock("../../../reviews/security", () => ({
  isTrustedAdminWrite: trustedWrite,
  resolveAdminAccess,
}));

import { POST } from "./route";

function context(kind = "university") {
  return { params: Promise.resolve({ kind, submissionId: "submission-1" }) };
}

function request() {
  return new Request("https://athenvia.example/api/admin/publications/university/submission-1", {
    headers: { origin: "https://athenvia.example" },
    method: "POST",
  });
}

describe("admin publication route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trustedWrite.mockReturnValue(true);
    resolveAdminAccess.mockResolvedValue({
      principal: { email: "admin@example.test", id: "admin-1" },
      status: "AUTHORIZED",
    });
    publishUniversity.mockResolvedValue({
      contributorUserId: "user-1",
      entityId: "university-1",
      outcome: "PUBLISHED",
      submissionId: "submission-1",
      submissionType: "UNIVERSITY",
    });
  });

  it("rejects untrusted writes before authentication", async () => {
    trustedWrite.mockReturnValue(false);
    const response = await POST(request(), context());
    expect(response.status).toBe(403);
    expect(resolveAdminAccess).not.toHaveBeenCalled();
  });

  it("publishes as an admin and returns a contributor notification intent", async () => {
    const response = await POST(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toMatchObject({
      contributorNotification: { type: "SUBMISSION_APPROVED", userId: "user-1" },
      entityId: "university-1",
      outcome: "PUBLISHED",
    });
    expect(publishUniversity).toHaveBeenCalledWith("submission-1");
  });

  it("rejects an unknown publication kind without touching the catalogue", async () => {
    const response = await POST(request(), context("unknown"));
    expect(response.status).toBe(400);
    expect(publishUniversity).not.toHaveBeenCalled();
    expect(publishProgram).not.toHaveBeenCalled();
  });
});
