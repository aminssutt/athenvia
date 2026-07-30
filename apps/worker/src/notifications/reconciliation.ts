import type { ExistingReminderDelivery, PlannedReminderDelivery } from "./types";

export type ReminderReconciliationAction =
  | {
      delivery: PlannedReminderDelivery;
      kind: "CREATE";
    }
  | {
      deliveryId: string;
      kind: "CANCEL";
    }
  | {
      deliveryId: string;
      kind: "REACTIVATE";
      scheduledFor: Date;
    }
  | {
      deliveryId: string;
      kind: "RESCHEDULE";
      scheduledFor: Date;
    };

export interface ReminderReconciliationPlan {
  actions: ReminderReconciliationAction[];
  unchanged: number;
}

/**
 * Compares persisted reminder rows with the complete desired state.
 *
 * Only SCHEDULED rows may be rescheduled/cancelled. CANCELLED rows may be
 * reactivated when a preference is turned back on. PROCESSING, SENT and FAILED
 * rows are immutable here: delivery/retry workers own their lifecycle.
 */
export function planReminderReconciliation(
  existing: readonly ExistingReminderDelivery[],
  desired: readonly PlannedReminderDelivery[],
): ReminderReconciliationPlan {
  const desiredByKey = new Map<string, PlannedReminderDelivery>();
  for (const delivery of desired) {
    if (desiredByKey.has(delivery.dedupeKey)) {
      throw new TypeError(`Duplicate desired reminder key: ${delivery.dedupeKey}`);
    }
    desiredByKey.set(delivery.dedupeKey, delivery);
  }

  const existingByKey = new Map(
    existing.map((delivery) => [delivery.dedupeKey, delivery] as const),
  );
  const actions: ReminderReconciliationAction[] = [];
  let unchanged = 0;

  for (const delivery of desired) {
    const persisted = existingByKey.get(delivery.dedupeKey);
    if (persisted === undefined) {
      actions.push({ delivery, kind: "CREATE" });
      continue;
    }

    if (persisted.status === "CANCELLED") {
      actions.push({
        deliveryId: persisted.id,
        kind: "REACTIVATE",
        scheduledFor: delivery.scheduledFor,
      });
      continue;
    }

    if (
      persisted.status === "SCHEDULED" &&
      persisted.scheduledFor.getTime() !== delivery.scheduledFor.getTime()
    ) {
      actions.push({
        deliveryId: persisted.id,
        kind: "RESCHEDULE",
        scheduledFor: delivery.scheduledFor,
      });
      continue;
    }

    unchanged += 1;
  }

  for (const persisted of existing) {
    if (persisted.status === "SCHEDULED" && !desiredByKey.has(persisted.dedupeKey)) {
      actions.push({ deliveryId: persisted.id, kind: "CANCEL" });
    }
  }

  return { actions, unchanged };
}
