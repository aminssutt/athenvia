import { planReminderDeliveries } from "./planner";
import { prismaReminderScheduleRepository, type ReminderScheduleRepository } from "./repository";
import { UTC_STORED_INSTANT_TIME_POLICY, type ReminderTimePolicy } from "./time-policy";
import type { ReminderReconciliationResult } from "./types";

export interface RescheduleWatchlistOptions {
  now?: Date;
  repository?: ReminderScheduleRepository;
  timePolicy?: ReminderTimePolicy;
}

export type RescheduleWatchlistResult =
  | {
      status: "NOT_FOUND";
      watchlistId: string;
    }
  | {
      planned: number;
      reconciliation: ReminderReconciliationResult;
      status: "RESCHEDULED";
      timePolicyId: string;
      watchlistId: string;
    };

/**
 * Recalculates one watchlist after a follow, preference edit, subscription
 * change or application-date change.
 */
export async function rescheduleWatchlistReminders(
  watchlistId: string,
  options: RescheduleWatchlistOptions = {},
): Promise<RescheduleWatchlistResult> {
  const repository = options.repository ?? prismaReminderScheduleRepository;
  const timePolicy = options.timePolicy ?? UTC_STORED_INSTANT_TIME_POLICY;
  const now = options.now ?? new Date();
  const atomicResult = await repository.reconcileWatchlistReminderDeliveries(
    watchlistId,
    (source) =>
      planReminderDeliveries(source, {
        now,
        timePolicy,
      }),
  );
  if (atomicResult === null) {
    return { status: "NOT_FOUND", watchlistId };
  }

  return {
    planned: atomicResult.planned,
    reconciliation: atomicResult.reconciliation,
    status: "RESCHEDULED",
    timePolicyId: timePolicy.id,
    watchlistId,
  };
}

export interface ReminderScheduleSweepOptions extends RescheduleWatchlistOptions {
  batchSize?: number;
}

export interface ReminderScheduleSweepResult {
  notFound: number;
  planned: number;
  reconciliation: ReminderReconciliationResult;
  timePolicyId: string;
  watchlists: number;
}

type ReminderScopeIdSelector = (repository: ReminderScheduleRepository) => Promise<string[]>;

async function reconcileReminderScope(
  selectIds: ReminderScopeIdSelector,
  options: RescheduleWatchlistOptions,
): Promise<ReminderScheduleSweepResult> {
  const repository = options.repository ?? prismaReminderScheduleRepository;
  const now = options.now ?? new Date();
  const timePolicy = options.timePolicy ?? UTC_STORED_INSTANT_TIME_POLICY;
  const aggregate: ReminderScheduleSweepResult = {
    notFound: 0,
    planned: 0,
    reconciliation: {
      cancelled: 0,
      created: 0,
      reactivated: 0,
      rescheduled: 0,
      unchanged: 0,
    },
    timePolicyId: timePolicy.id,
    watchlists: 0,
  };
  const watchlistIds = await selectIds(repository);

  for (const watchlistId of watchlistIds) {
    const result = await rescheduleWatchlistReminders(watchlistId, {
      now,
      repository,
      timePolicy,
    });
    if (result.status === "NOT_FOUND") {
      aggregate.notFound += 1;
      continue;
    }

    aggregate.watchlists += 1;
    aggregate.planned += result.planned;
    for (const key of [
      "cancelled",
      "created",
      "reactivated",
      "rescheduled",
      "unchanged",
    ] as const) {
      aggregate.reconciliation[key] += result.reconciliation[key];
    }
  }

  return aggregate;
}

/** Reconciles all watchlists affected by a user's preference/subscription edit. */
export function reconcileUserSchedules(
  userId: string,
  options: RescheduleWatchlistOptions = {},
): Promise<ReminderScheduleSweepResult> {
  return reconcileReminderScope(
    (repository) => repository.listWatchlistIdsForUser(userId),
    options,
  );
}

/** Reconciles all followers after any application date in an intake changes. */
export function reconcileIntakeSchedules(
  intakeId: string,
  options: RescheduleWatchlistOptions = {},
): Promise<ReminderScheduleSweepResult> {
  return reconcileReminderScope(
    (repository) => repository.listWatchlistIdsForIntake(intakeId),
    options,
  );
}

/** Reconciles all followers after one specific application window changes. */
export function reconcileApplicationWindowSchedules(
  applicationWindowId: string,
  options: RescheduleWatchlistOptions = {},
): Promise<ReminderScheduleSweepResult> {
  return reconcileReminderScope(
    (repository) => repository.listWatchlistIdsForApplicationWindow(applicationWindowId),
    options,
  );
}

/**
 * Reconciles every watchlist in stable, bounded pages. Capturing `now` once
 * keeps the past/future boundary identical for the whole sweep.
 */
export async function runReminderScheduleSweep(
  options: ReminderScheduleSweepOptions = {},
): Promise<ReminderScheduleSweepResult> {
  const repository = options.repository ?? prismaReminderScheduleRepository;
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
    throw new RangeError("batchSize must be an integer between 1 and 1000.");
  }

  const now = options.now ?? new Date();
  const timePolicy = options.timePolicy ?? UTC_STORED_INSTANT_TIME_POLICY;
  const aggregate: ReminderScheduleSweepResult = {
    notFound: 0,
    planned: 0,
    reconciliation: {
      cancelled: 0,
      created: 0,
      reactivated: 0,
      rescheduled: 0,
      unchanged: 0,
    },
    timePolicyId: timePolicy.id,
    watchlists: 0,
  };
  let afterId: string | undefined;

  while (true) {
    const watchlistIds = await repository.listWatchlistIds(afterId, batchSize);
    if (watchlistIds.length === 0) {
      break;
    }

    for (const watchlistId of watchlistIds) {
      const result = await rescheduleWatchlistReminders(watchlistId, {
        now,
        repository,
        timePolicy,
      });
      if (result.status === "NOT_FOUND") {
        aggregate.notFound += 1;
        continue;
      }

      aggregate.watchlists += 1;
      aggregate.planned += result.planned;
      for (const key of [
        "cancelled",
        "created",
        "reactivated",
        "rescheduled",
        "unchanged",
      ] as const) {
        aggregate.reconciliation[key] += result.reconciliation[key];
      }
    }

    const nextAfterId = watchlistIds.at(-1);
    if (nextAfterId === undefined || nextAfterId === afterId) {
      throw new Error("Reminder repository pagination did not advance.");
    }
    afterId = nextAfterId;

    if (watchlistIds.length < batchSize) {
      break;
    }
  }

  return aggregate;
}
