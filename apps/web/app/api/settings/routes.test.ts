import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  anonymizeAccount,
  getAuthenticatedUser,
  loadNotificationSettings,
  saveNotificationSettings,
} = vi.hoisted(() => ({
  anonymizeAccount: vi.fn(),
  getAuthenticatedUser: vi.fn(),
  loadNotificationSettings: vi.fn(),
  saveNotificationSettings: vi.fn(),
}));

vi.mock("./authenticated-user", () => ({ getAuthenticatedUser }));
vi.mock("./services", () => ({
  anonymizeAccount,
  loadNotificationSettings,
  saveNotificationSettings,
}));

import { DELETE as deleteAccount } from "./account/route";
import { GET as getNotifications, PATCH as patchNotifications } from "./notifications/route";

describe("settings route authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps notification settings private for anonymous visitors", async () => {
    getAuthenticatedUser.mockResolvedValue(null);

    const response = await getNotifications();

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(loadNotificationSettings).not.toHaveBeenCalled();
  });

  it("rejects cross-origin writes before resolving a session", async () => {
    const response = await patchNotifications(
      new Request("https://athenvia.example/api/settings/notifications", {
        body: JSON.stringify({
          dateChangeAlerts: true,
          deadlineReminders: true,
          openingReminders: true,
        }),
        headers: { origin: "https://attacker.example" },
        method: "PATCH",
      }),
    );

    expect(response.status).toBe(403);
    expect(getAuthenticatedUser).not.toHaveBeenCalled();
    expect(saveNotificationSettings).not.toHaveBeenCalled();
  });

  it("requires server-side confirmation for account deletion", async () => {
    getAuthenticatedUser.mockResolvedValue({
      email: "private@example.com",
      id: "user-1",
    });

    const response = await deleteAccount(
      new Request("https://athenvia.example/api/settings/account", {
        body: JSON.stringify({ confirmation: "delete" }),
        headers: {
          "content-type": "application/json",
          origin: "https://athenvia.example",
          "sec-fetch-site": "same-origin",
        },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(400);
    expect(anonymizeAccount).not.toHaveBeenCalled();
  });

  it("deletes only the identity resolved from the current session", async () => {
    const user = { email: "private@example.com", id: "user-1" };
    getAuthenticatedUser.mockResolvedValue(user);
    anonymizeAccount.mockResolvedValue(undefined);

    const response = await deleteAccount(
      new Request("https://athenvia.example/api/settings/account", {
        body: JSON.stringify({ confirmation: "DELETE" }),
        headers: {
          "content-type": "application/json",
          origin: "https://athenvia.example",
          "sec-fetch-site": "same-origin",
        },
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(anonymizeAccount).toHaveBeenCalledOnce();
    expect(anonymizeAccount).toHaveBeenCalledWith(user);
  });
});
