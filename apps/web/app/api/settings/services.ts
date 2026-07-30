import { database, type PrismaClient } from "@athenvia/database";
import { DEFAULT_DEADLINE_REMINDER_DAYS, DEFAULT_OPENING_REMINDER_DAYS } from "@athenvia/contracts";

import type { AuthenticatedUser } from "./authenticated-user";
import type { NotificationSettingsInput } from "./schemas";
import type {
  DeadlineReminderDay,
  NotificationSettingsResponse,
  OpeningReminderDay,
} from "@athenvia/contracts";

type TransactionDatabase = Pick<PrismaClient, "$transaction">;

export type NotificationSettings = NotificationSettingsResponse;

function canonicalStoredDays<T extends number>(
  storedDays: number[],
  allowedDays: readonly T[],
): T[] {
  return allowedDays.filter((day) => storedDays.includes(day));
}

function commonScheduleDays<T extends number>(schedules: T[][], allowedDays: readonly T[]): T[] {
  if (schedules.length === 0) {
    return [...allowedDays];
  }

  return allowedDays.filter((day) => schedules.every((schedule) => schedule.includes(day)));
}

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
            beforeOpenDays: true,
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

  const openingSchedules = watchlists.map(({ notificationPreference }) => {
    if (!notificationPreference) {
      return [...DEFAULT_OPENING_REMINDER_DAYS];
    }

    const positiveDays = canonicalStoredDays(
      notificationPreference.beforeOpenDays,
      DEFAULT_OPENING_REMINDER_DAYS.filter((day) => day > 0),
    );
    return notificationPreference.notifyOnOpen ? [...positiveDays, 0 as const] : positiveDays;
  });
  const deadlineSchedules = watchlists.map(({ notificationPreference }) =>
    notificationPreference
      ? canonicalStoredDays(
          notificationPreference.beforeDeadlineDays,
          DEFAULT_DEADLINE_REMINDER_DAYS,
        )
      : [...DEFAULT_DEADLINE_REMINDER_DAYS],
  );
  const openingReminderDays = commonScheduleDays<OpeningReminderDay>(
    openingSchedules,
    DEFAULT_OPENING_REMINDER_DAYS,
  );
  const deadlineReminderDays = commonScheduleDays<DeadlineReminderDay>(
    deadlineSchedules,
    DEFAULT_DEADLINE_REMINDER_DAYS,
  );

  return {
    activePushSubscriptions,
    dateChangeAlerts: watchlists.every(
      ({ notificationPreference }) => notificationPreference?.notifyOnDateChange ?? true,
    ),
    deadlineReminderDays,
    deadlineReminders: deadlineReminderDays.length > 0,
    openingReminderDays,
    openingReminders: openingReminderDays.length > 0,
    trackedPrograms: watchlists.length,
  };
}

export async function saveNotificationSettings(
  userId: string,
  settings: NotificationSettingsInput,
  client: TransactionDatabase = database,
): Promise<void> {
  await client.$transaction(async (transaction) => {
    const beforeOpenDays = settings.openingReminderDays.filter((day) => day > 0);
    const notifyOnOpen = settings.openingReminderDays.includes(0);
    const watchlists = await transaction.userWatchlist.findMany({
      where: { userId },
      select: { id: true },
    });

    if (watchlists.length === 0) {
      return;
    }

    await transaction.notificationPreference.createMany({
      data: watchlists.map(({ id }) => ({
        beforeDeadlineDays: settings.deadlineReminderDays,
        beforeOpenDays,
        notifyOnDateChange: settings.dateChangeAlerts,
        notifyOnOpen,
        watchlistId: id,
      })),
      skipDuplicates: true,
    });

    await transaction.notificationPreference.updateMany({
      data: {
        beforeDeadlineDays: settings.deadlineReminderDays,
        beforeOpenDays,
        notifyOnDateChange: settings.dateChangeAlerts,
        notifyOnOpen,
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
