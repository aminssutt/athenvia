import { beforeEach, describe, expect, it, vi } from "vitest";

const { decideAdminReview, listPendingAdminReviews, resolveAdminAccess, trustedWrite } = vi.hoisted(
  () => ({
    decideAdminReview: vi.fn(),
    listPendingAdminReviews: vi.fn(),
    resolveAdminAccess: vi.fn(),
    trustedWrite: vi.fn(),
  }),
);

vi.mock("./service", () => ({
  AdminReviewConflictError: class AdminReviewConflictError extends Error {},
  AdminReviewNotFoundError: class AdminReviewNotFoundError extends Error {},
  decideAdminReview,
  listPendingAdminReviews,
}));
vi.mock("./security", () => ({
  isTrustedAdminWrite: trustedWrite,
  resolveAdminAccess,
}));

import { GET } from "./route";
import { POST } from "./[revisionId]/route";

function request(decision: unknown, origin = "https://athenvia.example") {
  return new Request("https://athenvia.example/api/admin/reviews/revision-1", {
    body: JSON.stringify({ decision }),
    headers: { "content-type": "application/json", origin },
    method: "POST",
  });
}

const context = { params: Promise.resolve({ revisionId: "revision-1" }) };

describe("admin review routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trustedWrite.mockReturnValue(true);
    resolveAdminAccess.mockResolvedValue({
      principal: { email: "admin@example.com", id: "admin-1" },
      status: "AUTHORIZED",
    });
    listPendingAdminReviews.mockResolvedValue([]);
    decideAdminReview.mockResolvedValue(undefined);
  });

  it("keeps the queue private for anonymous and non-admin users", async () => {
    resolveAdminAccess.mockResolvedValueOnce({ status: "UNAUTHENTICATED" });
    expect((await GET()).status).toBe(401);
    resolveAdminAccess.mockResolvedValueOnce({ status: "FORBIDDEN" });
    expect((await GET()).status).toBe(403);
    expect(listPendingAdminReviews).not.toHaveBeenCalled();
  });

  it("returns an authorized queue with private no-store caching", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ reviews: [] });
  });

  it("rejects cross-origin writes before resolving authentication", async () => {
    trustedWrite.mockReturnValue(false);
    const response = await POST(request("APPROVE", "https://attacker.example"), context);
    expect(response.status).toBe(403);
    expect(resolveAdminAccess).not.toHaveBeenCalled();
    expect(decideAdminReview).not.toHaveBeenCalled();
  });

  it("accepts only explicit decisions and audits as the session administrator", async () => {
    expect((await POST(request("DELETE"), context)).status).toBe(400);
    const response = await POST(request("APPROVE"), context);
    expect(response.status).toBe(200);
    expect(decideAdminReview).toHaveBeenCalledWith("revision-1", "admin-1", "APPROVE");
  });
});
