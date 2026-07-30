const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1_000;

/**
 * Defines how an application-window instant and a reminder offset become a
 * delivery instant. The policy is deliberately injectable: the current data
 * model has no user timezone, so a future timezone-aware policy can replace
 * this one without changing the planner or persistence layer.
 */
export interface ReminderTimePolicy {
  readonly id: string;
  readonly timeZone: string;
  reminderAt(applicationEventAt: Date, daysBefore: number): Date;
}

/**
 * Current model policy:
 * - opensAt/closesAt are interpreted as the exact UTC instants stored by Prisma;
 * - one reminder day is exactly 24 hours;
 * - no server-local timezone or DST conversion is applied.
 *
 * This is deterministic across hosts and DST boundaries. It is not user-local
 * scheduling; that requires a timezone field in the persistence model.
 */
export const UTC_STORED_INSTANT_TIME_POLICY: ReminderTimePolicy = Object.freeze({
  id: "stored-instant-utc-v1",
  timeZone: "UTC",
  reminderAt(applicationEventAt: Date, daysBefore: number): Date {
    return new Date(applicationEventAt.getTime() - daysBefore * MILLISECONDS_PER_DAY);
  },
});
