import { describe, expect, it, vi } from "vitest";

import {
  anonymizeAccount,
  loadNotificationSettings,
  saveNotificationSettings,
  unsubscribeFromNotifications,
} from "./services";

function transactionHost(transaction: object) {
  return {
    $transaction: vi.fn(async (operation: (client: object) => Promise<unknown>) =>
      operation(transaction),
    ),
  };
}

describe("notification settings services", () => {
  it("uses privacy-safe defaults for watchlists without a preference row", async () => {
    const client = {
      pushSubscription: {
        count: vi.fn().mockResolvedValue(2),
      },
      userWatchlist: {
        findMany: vi.fn().mockResolvedValue([
          { notificationPreference: null },
          {
            notificationPreference: {
              beforeDeadlineDays: [14, 2],
              notifyOnDateChange: true,
              notifyOnOpen: true,
            },
          },
        ]),
      },
    };

    await expect(loadNotificationSettings("user-1", client as never)).resolves.toEqual({
      activePushSubscriptions: 2,
      dateChangeAlerts: true,
      deadlineReminders: true,
      openingReminders: true,
      trackedPrograms: 2,
    });
  });

  it("creates missing preferences and updates every watchlist owned by the user", async () => {
    const transaction = {
      notificationPreference: {
        createMany: vi.fn().mockResolvedValue({ count: 2 }),
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      userWatchlist: {
        findMany: vi.fn().mockResolvedValue([{ id: "watch-1" }, { id: "watch-2" }]),
      },
    };
    const client = transactionHost(transaction);

    await saveNotificationSettings(
      "user-1",
      {
        dateChangeAlerts: false,
        deadlineReminders: false,
        openingReminders: true,
      },
      client as never,
    );

    expect(transaction.notificationPreference.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ beforeDeadlineDays: [], watchlistId: "watch-1" }),
          expect.objectContaining({ beforeDeadlineDays: [], watchlistId: "watch-2" }),
        ],
        skipDuplicates: true,
      }),
    );
    expect(transaction.notificationPreference.updateMany).toHaveBeenCalledWith({
      data: {
        beforeDeadlineDays: [],
        notifyOnDateChange: false,
        notifyOnOpen: true,
      },
      where: { watchlist: { userId: "user-1" } },
    });
  });

  it("revokes devices, disables push and cancels only unsent deliveries", async () => {
    const transaction = {
      notificationDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
      notificationPreference: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      pushSubscription: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const client = transactionHost(transaction);
    const revokedAt = new Date("2026-07-30T12:00:00.000Z");

    await unsubscribeFromNotifications("user-1", revokedAt, client as never);

    expect(transaction.pushSubscription.updateMany).toHaveBeenCalledWith({
      data: { revokedAt },
      where: { revokedAt: null, userId: "user-1" },
    });
    expect(transaction.notificationPreference.updateMany).toHaveBeenCalledWith({
      data: { pushEnabled: false },
      where: { watchlist: { userId: "user-1" } },
    });
    expect(transaction.notificationDelivery.updateMany).toHaveBeenCalledWith({
      data: { status: "CANCELLED" },
      where: { status: "SCHEDULED", userId: "user-1" },
    });
  });
});

describe("account deletion service", () => {
  it("removes private records and replaces personal identity atomically", async () => {
    const transaction = {
      account: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      notificationDelivery: { deleteMany: vi.fn().mockResolvedValue({ count: 4 }) },
      pushSubscription: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
      user: { update: vi.fn().mockResolvedValue({ id: "user-1" }) },
      userWatchlist: { deleteMany: vi.fn().mockResolvedValue({ count: 3 }) },
      verificationToken: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const client = transactionHost(transaction);

    await anonymizeAccount({ email: "private@example.com", id: "user-1" }, client as never);

    expect(client.$transaction).toHaveBeenCalledOnce();
    expect(transaction.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { identifier: "private@example.com" },
    });
    expect(transaction.notificationDelivery.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(transaction.userWatchlist.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(transaction.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(transaction.account.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(transaction.session.deleteMany).toHaveBeenCalledWith({
      where: { userId: "user-1" },
    });
    expect(transaction.user.update).toHaveBeenCalledWith({
      data: {
        email: "deleted-user-1@deleted.invalid",
        emailVerified: null,
        image: null,
        name: null,
      },
      where: { id: "user-1" },
    });
    expect(JSON.stringify(transaction.user.update.mock.calls)).not.toContain("private@example.com");
  });
});
