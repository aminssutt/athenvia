import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  unfollowProgram: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock("@athenvia/database", () => ({
  database: {
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
  unfollowProgram: mocks.unfollowProgram,
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

import { DELETE } from "./route";

const userId = "8bc96ced-a2a7-4d0b-830d-c6ed0a794d8b";
const watchlistId = "ce360523-9c52-438a-b64a-0e7a650c6fc8";

function unfollowRequest(): Request {
  return new Request(`https://athenvia.test/api/watchlist/${watchlistId}`, {
    method: "DELETE",
    headers: {
      Origin: "https://athenvia.test",
      "Sec-Fetch-Site": "same-origin",
    },
  });
}

function context(id = watchlistId) {
  return {
    params: Promise.resolve({ watchlistId: id }),
  };
}

describe("DELETE /api/watchlist/:watchlistId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { email: "student@example.test" },
    });
    mocks.userFindUnique.mockResolvedValue({ id: userId });
  });

  it("rejects malformed identifiers without touching the database", async () => {
    const response = await DELETE(unfollowRequest(), context("not-a-uuid"));

    expect(response.status).toBe(400);
    expect(mocks.unfollowProgram).not.toHaveBeenCalled();
  });

  it("scopes deletion to the session owner and returns no content", async () => {
    mocks.unfollowProgram.mockResolvedValue(true);

    const response = await DELETE(unfollowRequest(), context());

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.unfollowProgram).toHaveBeenCalledWith(userId, watchlistId);
  });

  it("is indistinguishably idempotent for an absent or foreign-owned row", async () => {
    mocks.unfollowProgram.mockResolvedValue(false);

    const response = await DELETE(unfollowRequest(), context());

    expect(response.status).toBe(204);
    expect(response.body).toBeNull();
  });

  it("requires authentication before accepting an identifier", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await DELETE(unfollowRequest(), context());

    expect(response.status).toBe(401);
    expect(mocks.unfollowProgram).not.toHaveBeenCalled();
  });
});
