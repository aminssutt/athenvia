import { DEFAULT_DEADLINE_REMINDER_DAYS, DEFAULT_OPENING_REMINDER_DAYS } from "@athenvia/contracts";
import { database } from "@athenvia/database";
import type { Prisma } from "@athenvia/database";

import { REMINDER_DEDUPE_PREFIX } from "./planner";
import { planReminderReconciliation } from "./reconciliation";
import type {
  PlannedReminderDelivery,
  ReminderReconciliationResult,
  WatchlistReminderSource,
} from "./types";

const DEFAULT_PAGE_SIZE = 100;

export interface ReminderScheduleRepository {
  listWatchlistIds(afterId?: string, limit?: number): Promise<string[]>;
  listWatchlistIdsForApplicationWindow(applicationWindowId: string): Promise<string[]>;
  listWatchlistIdsForIntake(intakeId: string): Promise<string[]>;
  listWatchlistIdsForUser(userId: string): Promise<string[]>;
  reconcileWatchlistReminderDeliveries(
    watchlistId: string,
    planDesired: (source: WatchlistReminderSource) => readonly PlannedReminderDelivery[],
  ): Promise<AtomicReminderReconciliation | null>;
}

export interface AtomicReminderReconciliation {
  planned: number;
  reconciliation: ReminderReconciliationResult;
}

function managedDedupePrefix(watchlistId: string): string {
  return `${REMINDER_DEDUPE_PREFIX}:${watchlistId}:`;
}

export class PrismaReminderScheduleRepository implements ReminderScheduleRepository {
  constructor(private readonly client: typeof database = database) {}

  async listWatchlistIds(afterId?: string, limit = DEFAULT_PAGE_SIZE): Promise<string[]> {
    const watchlists = await this.client.userWatchlist.findMany({
      orderBy: { id: "asc" },
      select: { id: true },
      take: limit,
      where: afterId === undefined ? undefined : { id: { gt: afterId } },
    });
    return watchlists.map(({ id }) => id);
  }

  async listWatchlistIdsForApplicationWindow(applicationWindowId: string): Promise<string[]> {
    const watchlists = await this.client.userWatchlist.findMany({
      orderBy: { id: "asc" },
      select: { id: true },
      where: {
        intake: {
          applicationWindows: {
            some: { id: applicationWindowId },
          },
        },
      },
    });
    return watchlists.map(({ id }) => id);
  }

  async listWatchlistIdsForIntake(intakeId: string): Promise<string[]> {
    const watchlists = await this.client.userWatchlist.findMany({
      orderBy: { id: "asc" },
      select: { id: true },
      where: { intakeId },
    });
    return watchlists.map(({ id }) => id);
  }

  async listWatchlistIdsForUser(userId: string): Promise<string[]> {
    const watchlists = await this.client.userWatchlist.findMany({
      orderBy: { id: "asc" },
      select: { id: true },
      where: { userId },
    });
    return watchlists.map(({ id }) => id);
  }

  private async loadSource(
    client: Pick<Prisma.TransactionClient, "userWatchlist">,
    watchlistId: string,
  ): Promise<WatchlistReminderSource | null> {
    const watchlist = await client.userWatchlist.findUnique({
      where: { id: watchlistId },
      select: {
        id: true,
        intake: {
          select: {
            applicationWindows: {
              orderBy: { id: "asc" },
              select: {
                closesAt: true,
                id: true,
                opensAt: true,
                publicStatus: true,
              },
            },
          },
        },
        notificationPreference: {
          select: {
            beforeDeadlineDays: true,
            beforeOpenDays: true,
            notifyOnOpen: true,
          },
        },
        user: {
          select: {
            pushSubscriptions: {
              take: 1,
              where: { revokedAt: null },
              select: { id: true },
            },
          },
        },
        userId: true,
        trackingStatus: true,
      },
    });

    if (watchlist === null) {
      return null;
    }

    const preference = watchlist.notificationPreference ?? {
      beforeDeadlineDays: [...DEFAULT_DEADLINE_REMINDER_DAYS],
      beforeOpenDays: DEFAULT_OPENING_REMINDER_DAYS.filter((day) => day > 0),
      notifyOnOpen: true,
    };

    return {
      applicationWindows: watchlist.intake.applicationWindows,
      // pushEnabled is currently legacy/inert. An active endpoint is the
      // authoritative signal that this user can receive push reminders.
      hasActivePushSubscription: watchlist.user.pushSubscriptions.length > 0,
      preference,
      trackingStatus: watchlist.trackingStatus,
      userId: watchlist.userId,
      watchlistId: watchlist.id,
    };
  }

  async reconcileWatchlistReminderDeliveries(
    watchlistId: string,
    planDesired: (source: WatchlistReminderSource) => readonly PlannedReminderDelivery[],
  ): Promise<AtomicReminderReconciliation | null> {
    return this.client.$transaction(async (transaction) => {
      // The source must be loaded after this lock. Otherwise a delayed run
      // could read an old date/preference, acquire the lock after a newer run,
      // and overwrite the newer schedule.
      const lockKey = `${REMINDER_DEDUPE_PREFIX}:${watchlistId}`;
      await transaction.$queryRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS acquired
      `;

      const source = await this.loadSource(transaction, watchlistId);
      if (source === null) {
        return null;
      }
      const desired = planDesired(source);
      if (
        desired.some(
          (delivery) =>
            delivery.watchlistId !== source.watchlistId || delivery.userId !== source.userId,
        )
      ) {
        throw new TypeError("All desired reminders must belong to the reconciled watchlist.");
      }

      const existing = await transaction.notificationDelivery.findMany({
        where: {
          dedupeKey: { startsWith: managedDedupePrefix(source.watchlistId) },
          watchlistId: source.watchlistId,
        },
        select: {
          dedupeKey: true,
          id: true,
          scheduledFor: true,
          status: true,
        },
      });
      const plan = planReminderReconciliation(existing, desired);
      const result: ReminderReconciliationResult = {
        cancelled: 0,
        created: 0,
        reactivated: 0,
        rescheduled: 0,
        unchanged: plan.unchanged,
      };

      for (const action of plan.actions) {
        if (action.kind === "CANCEL") {
          const update = await transaction.notificationDelivery.updateMany({
            where: { id: action.deliveryId, status: "SCHEDULED" },
            data: { status: "CANCELLED" },
          });
          result.cancelled += update.count;
          continue;
        }

        if (action.kind === "REACTIVATE") {
          const update = await transaction.notificationDelivery.updateMany({
            where: { id: action.deliveryId, status: "CANCELLED" },
            data: {
              errorMessage: null,
              scheduledFor: action.scheduledFor,
              status: "SCHEDULED",
            },
          });
          result.reactivated += update.count;
          continue;
        }

        if (action.kind === "RESCHEDULE") {
          const update = await transaction.notificationDelivery.updateMany({
            where: { id: action.deliveryId, status: "SCHEDULED" },
            data: {
              errorMessage: null,
              scheduledFor: action.scheduledFor,
            },
          });
          result.rescheduled += update.count;
        }
      }

      const creates = plan.actions
        .filter((action) => action.kind === "CREATE")
        .map(({ delivery }) => ({
          dedupeKey: delivery.dedupeKey,
          notificationType: delivery.notificationType,
          scheduledFor: delivery.scheduledFor,
          status: "SCHEDULED" as const,
          userId: delivery.userId,
          watchlistId: delivery.watchlistId,
        }));
      if (creates.length > 0) {
        const create = await transaction.notificationDelivery.createMany({
          data: creates,
          skipDuplicates: true,
        });
        result.created = create.count;
      }

      return {
        planned: desired.length,
        reconciliation: result,
      };
    });
  }
}

export const prismaReminderScheduleRepository = new PrismaReminderScheduleRepository();
