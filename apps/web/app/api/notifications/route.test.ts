import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  loadNotificationHistory: vi.fn(),
}));

vi.mock("../settings/authenticated-user", () => ({
  getAuthenticatedUser: mocks.getAuthenticatedUser,
}));

vi.mock("./history", () => ({
  loadNotificationHistory: mocks.loadNotificationHistory,
}));

import { GET } from "./route";

const ownerId = "11111111-1111-4111-8111-111111111111";

describe("GET /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthenticatedUser.mockResolvedValue({
      email: "student@example.test",
      id: ownerId,
    });
    mocks.loadNotificationHistory.mockResolvedValue([]);
  });

  it("keeps anonymous history private", async () => {
    mocks.getAuthenticatedUser.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.loadNotificationHistory).not.toHaveBeenCalled();
  });

  it("ignores caller-selected ownership and loads only the session owner", async () => {
    const response = await GET(
      new Request(
        "https://athenvia.example/api/notifications?userId=99999999-9999-4999-8999-999999999999",
      ),
    );

    expect(response.status).toBe(200);
    expect(mocks.loadNotificationHistory).toHaveBeenCalledWith(ownerId);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({ items: [] });
  });

  it("returns a generic secret-free failure when auth or storage is unavailable", async () => {
    const secret = "DATABASE_SECRET_MUST_NOT_LEAK";
    mocks.getAuthenticatedUser.mockRejectedValue(new Error(secret));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await GET();
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(serialized).not.toContain(secret);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    expect(mocks.loadNotificationHistory).not.toHaveBeenCalled();
  });

  it("does not serialize internal delivery fields", async () => {
    mocks.loadNotificationHistory.mockResolvedValue([
      {
        description: "A reminder about an upcoming application deadline.",
        href: "/programs/22222222-2222-4222-8222-222222222222",
        id: "33333333-3333-4333-8333-333333333333",
        notificationType: "APPLICATION_DEADLINE",
        program: {
          id: "22222222-2222-4222-8222-222222222222",
          name: "MSc Responsible AI",
          universityName: "Example University",
        },
        scheduledFor: "2026-08-01T09:00:00.000Z",
        sentAt: null,
        status: "FAILED",
        title: "Application deadline",
      },
    ]);

    const response = await GET();
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("errorMessage");
    expect(serialized).not.toContain("dedupeKey");
    expect(serialized).not.toContain("privateNotes");
  });
});
