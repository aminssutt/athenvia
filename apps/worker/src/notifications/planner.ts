import { DEFAULT_DEADLINE_REMINDER_DAYS, DEFAULT_OPENING_REMINDER_DAYS } from "@athenvia/contracts";

import { UTC_STORED_INSTANT_TIME_POLICY, type ReminderTimePolicy } from "./time-policy";
import type {
  PlannedReminderDelivery,
  ReminderNotificationType,
  WatchlistReminderSource,
} from "./types";

export const REMINDER_DEDUPE_PREFIX = "athenvia:reminder:v1";

const openingOffsetsBeforeDate = DEFAULT_OPENING_REMINDER_DAYS.filter((offset) => offset > 0);
const allowedOpeningOffsets = new Set<number>(openingOffsetsBeforeDate);
const allowedDeadlineOffsets = new Set<number>(DEFAULT_DEADLINE_REMINDER_DAYS);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function canonicalOffsets(
  offsets: readonly number[],
  allowed: ReadonlySet<number>,
  canonicalOrder: readonly number[],
): number[] {
  const selected = new Set(
    offsets.filter((offset) => Number.isInteger(offset) && allowed.has(offset)),
  );
  return canonicalOrder.filter((offset) => selected.has(offset));
}

function reminderDedupeKey(
  watchlistId: string,
  windowId: string,
  notificationType: ReminderNotificationType,
  offsetDays: number,
): string {
  if (!UUID_PATTERN.test(watchlistId) || !UUID_PATTERN.test(windowId)) {
    throw new TypeError("Reminder dedupe identifiers must be UUIDs.");
  }
  const reminderKind = notificationType === "APPLICATION_OPENING" ? "opening" : "deadline";
  return [REMINDER_DEDUPE_PREFIX, watchlistId, windowId, reminderKind, String(offsetDays)].join(
    ":",
  );
}

export interface PlanReminderDeliveriesOptions {
  now: Date;
  timePolicy?: ReminderTimePolicy;
}

/**
 * Builds the complete desired future reminder state for one watchlist.
 *
 * Dedupe keys intentionally exclude the application date. A date correction
 * therefore reschedules the same pending delivery instead of accumulating a
 * second row.
 */
export function planReminderDeliveries(
  source: WatchlistReminderSource,
  options: PlanReminderDeliveriesOptions,
): PlannedReminderDelivery[] {
  if (!(options.now instanceof Date) || !Number.isFinite(options.now.getTime())) {
    throw new TypeError("Reminder planning requires a valid now instant.");
  }
  if (!source.hasActivePushSubscription || source.trackingStatus === "APPLIED") {
    return [];
  }

  const timePolicy = options.timePolicy ?? UTC_STORED_INSTANT_TIME_POLICY;
  const openingOffsets = canonicalOffsets(
    source.preference.beforeOpenDays,
    allowedOpeningOffsets,
    openingOffsetsBeforeDate,
  );
  if (source.preference.notifyOnOpen && !openingOffsets.includes(0)) {
    openingOffsets.push(0);
  }
  const deadlineOffsets = canonicalOffsets(
    source.preference.beforeDeadlineDays,
    allowedDeadlineOffsets,
    DEFAULT_DEADLINE_REMINDER_DAYS,
  );
  const planned: PlannedReminderDelivery[] = [];

  const addReminder = (
    windowId: string,
    eventAt: Date | null,
    notificationType: ReminderNotificationType,
    offsetDays: number,
  ) => {
    if (eventAt === null || !Number.isFinite(eventAt.getTime())) {
      return;
    }

    const scheduledFor = timePolicy.reminderAt(eventAt, offsetDays);
    if (
      !Number.isFinite(scheduledFor.getTime()) ||
      scheduledFor.getTime() <= options.now.getTime()
    ) {
      return;
    }

    planned.push({
      dedupeKey: reminderDedupeKey(source.watchlistId, windowId, notificationType, offsetDays),
      notificationType,
      offsetDays,
      scheduledFor,
      userId: source.userId,
      watchlistId: source.watchlistId,
      windowId,
    });
  };

  for (const window of source.applicationWindows) {
    if (window.publicStatus === "NOT_PUBLISHED") {
      continue;
    }
    for (const offsetDays of openingOffsets) {
      addReminder(window.id, window.opensAt, "APPLICATION_OPENING", offsetDays);
    }
    for (const offsetDays of deadlineOffsets) {
      addReminder(window.id, window.closesAt, "APPLICATION_DEADLINE", offsetDays);
    }
  }

  return planned.sort(
    (left, right) =>
      left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
      left.dedupeKey.localeCompare(right.dedupeKey),
  );
}
