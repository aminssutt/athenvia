import { database, type PrismaClient } from "@athenvia/database";

import type { AuthenticatedUser } from "./authenticated-user";
import type { NotificationSettingsInput } from "./schemas";

const DEFAULT_BEFORE_OPEN_DAYS = [30, 7];
const DEFAULT_BEFORE_DEADLINE_DAYS = [30, 14, 7, 2];

type TransactionDatabase = Pick<PrismaClient, "$transaction">;

export type NotificationSettings = NotificationSettingsInput & {
  activePushSubscriptions: number;
  trackedPrograms: number;
};

export async function loadNotificationSettings(
  userId: string,
  client: Pick<PrismaClient, "pushSubscription" | "userWatchlist"> = database,
): Promise<NotificationSettings> {
  const [watchlists, activePushSubscriptions] = await Promise.all([
    client.userWatchlist.findMany({
      where: { userId },
      select: {
        notificationPreference: {
          select: {
            beforeDeadlineDays: true,
            notifyOnDateChange: true,
            notifyOnOpen: true,
          },
        },
      },
    }),
    client.pushSubscription.count({
      where: {
        revokedAt: null,
        userId,
      },
    }),
  ]);

  return {
    activePushSubscriptions,
    dateChangeAlerts: watchlists.every(
      ({ notificationPreference }) => notificationPreference?.notifyOnDateChange ?? true,
    ),
    deadlineReminders: watchlists.every(
      ({ notificationPreference }) =>
        (notificationPreference?.beforeDeadlineDays.length ?? DEFAULT_BEFORE_DEADLINE_DAYS.length) >
        0,
    ),
    openingReminders: watchlists.every(
      ({ notificationPreference }) => notificationPreference?.notifyOnOpen ?? true,
    ),
    trackedPrograms: watchlists.length,
  };
}

export async function saveNotificationSettings(
  userId: string,
  settings: NotificationSettingsInput,
  client: TransactionDatabase = database,
): Promise<void> {
  await client.$transaction(async (transaction) => {
    const watchlists = await transaction.userWatchlist.findMany({
      where: { userId },
      select: { id: true },
    });

    if (watchlists.length === 0) {
      return;
    }

    await transaction.notificationPreference.createMany({
      data: watchlists.map(({ id }) => ({
        beforeDeadlineDays: settings.deadlineReminders ? DEFAULT_BEFORE_DEADLINE_DAYS : [],
        beforeOpenDays: DEFAULT_BEFORE_OPEN_DAYS,
        notifyOnDateChange: settings.dateChangeAlerts,
        notifyOnOpen: settings.openingReminders,
        watchlistId: id,
      })),
      skipDuplicates: true,
    });

    await transaction.notificationPreference.updateMany({
      data: {
        beforeDeadlineDays: settings.deadlineReminders ? DEFAULT_BEFORE_DEADLINE_DAYS : [],
        notifyOnDateChange: settings.dateChangeAlerts,
        notifyOnOpen: settings.openingReminders,
      },
      where: {
        watchlist: { userId },
      },
    });
  });
}

export async function unsubscribeFromNotifications(
  userId: string,
  revokedAt = new Date(),
  client: TransactionDatabase = database,
): Promise<void> {
  await client.$transaction(async (transaction) => {
    await transaction.pushSubscription.updateMany({
      data: { revokedAt },
      where: {
        revokedAt: null,
        userId,
      },
    });

    await transaction.notificationPreference.updateMany({
      data: { pushEnabled: false },
      where: {
        watchlist: { userId },
      },
    });

    await transaction.notificationDelivery.updateMany({
      data: { status: "CANCELLED" },
      where: {
        status: "SCHEDULED",
        userId,
      },
    });
  });
}

export async function anonymizeAccount(
  user: AuthenticatedUser,
  client: TransactionDatabase = database,
): Promise<void> {
  await client.$transaction(async (transaction) => {
    await transaction.verificationToken.deleteMany({
      where: { identifier: user.email },
    });
    await transaction.notificationDelivery.deleteMany({ where: { userId: user.id } });
    await transaction.userWatchlist.deleteMany({ where: { userId: user.id } });
    await transaction.pushSubscription.deleteMany({ where: { userId: user.id } });
    await transaction.account.deleteMany({ where: { userId: user.id } });
    await transaction.session.deleteMany({ where: { userId: user.id } });

    await transaction.user.update({
      data: {
        email: `deleted-${user.id}@deleted.invalid`,
        emailVerified: null,
        image: null,
        name: null,
      },
      where: { id: user.id },
    });
  });
}
