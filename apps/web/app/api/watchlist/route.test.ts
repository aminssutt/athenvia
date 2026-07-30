import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class TargetNotFoundError extends Error {}

  return {
    TargetNotFoundError,
    followProgram: vi.fn(),
    getServerSession: vi.fn(),
    userFindUnique: vi.fn(),
  };
});

vi.mock("@athenvia/database", () => ({
  database: {
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
  followProgram: mocks.followProgram,
  WatchlistTargetNotFoundError: mocks.TargetNotFoundError,
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

import { POST } from "./route";

const programId = "f82f46cd-369f-4dc5-96a9-dc9d075e748b";
const intakeId = "c2c7e720-c590-4551-9d18-91aef2db006d";
const userId = "8bc96ced-a2a7-4d0b-830d-c6ed0a794d8b";

function followRequest(body: unknown, origin = "https://athenvia.test"): Request {
  return new Request("https://athenvia.test/api/watchlist", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "Sec-Fetch-Site": "same-origin",
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/watchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { email: "student@example.test" },
    });
    mocks.userFindUnique.mockResolvedValue({ id: userId });
  });

  it("rejects cross-site requests before reading a session", async () => {
    const response = await POST(followRequest({ programId, intakeId }, "https://attacker.test"));

    expect(response.status).toBe(403);
    expect(mocks.getServerSession).not.toHaveBeenCalled();
    expect(mocks.followProgram).not.toHaveBeenCalled();
  });

  it("requires a database-backed authenticated user", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(followRequest({ programId, intakeId }));

    expect(response.status).toBe(401);
    expect(mocks.followProgram).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { programId: "not-a-uuid", intakeId },
    { programId, intakeId: "not-a-uuid" },
    { programId, intakeId, userId },
  ])("rejects an invalid or ownership-bearing body", async (body) => {
    const response = await POST(followRequest(body));

    expect(response.status).toBe(400);
    expect(mocks.followProgram).not.toHaveBeenCalled();
  });

  it("creates a watchlist for the session owner", async () => {
    const result = {
      created: true,
      watchlist: {
        id: "ce360523-9c52-438a-b64a-0e7a650c6fc8",
        programId,
        intakeId,
        trackingStatus: "WATCHING",
        priority: 0,
        createdAt: new Date("2026-07-30T12:00:00.000Z"),
        notificationPreference: {
          beforeOpenDays: [30, 7],
          beforeDeadlineDays: [30, 14, 7, 2],
          notifyOnOpen: true,
          notifyOnDateChange: true,
          pushEnabled: false,
        },
      },
    };
    mocks.followProgram.mockResolvedValue(result);

    const response = await POST(followRequest({ programId, intakeId }));

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.followProgram).toHaveBeenCalledWith({
      userId,
      programId,
      intakeId,
    });
    await expect(response.json()).resolves.toMatchObject({
      created: true,
      watchlist: {
        id: result.watchlist.id,
        notificationPreference: {
          beforeOpenDays: [30, 7],
        },
      },
    });
  });

  it("returns an idempotent success when the follow already exists", async () => {
    mocks.followProgram.mockResolvedValue({
      created: false,
      watchlist: {
        id: "ce360523-9c52-438a-b64a-0e7a650c6fc8",
      },
    });

    const response = await POST(followRequest({ programId, intakeId }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ created: false });
  });

  it("does not expose unavailable catalogue targets", async () => {
    mocks.followProgram.mockRejectedValue(new mocks.TargetNotFoundError());

    const response = await POST(followRequest({ programId, intakeId }));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "PROGRAM_INTAKE_NOT_FOUND" },
    });
  });
});
