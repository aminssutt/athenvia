import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planReminderReconciliation } from "./reconciliation";
import type { ExistingReminderDelivery, PlannedReminderDelivery } from "./types";

const scheduledFor = new Date("2026-05-01T00:00:00.000Z");

function desired(dedupeKey: string, at = scheduledFor): PlannedReminderDelivery {
  return {
    dedupeKey,
    notificationType: "APPLICATION_OPENING",
    offsetDays: 7,
    scheduledFor: at,
    userId: "11111111-1111-4111-8111-111111111111",
    watchlistId: "22222222-2222-4222-8222-222222222222",
    windowId: "33333333-3333-4333-8333-333333333333",
  };
}

function existing(
  dedupeKey: string,
  status: ExistingReminderDelivery["status"] = "SCHEDULED",
  at = scheduledFor,
): ExistingReminderDelivery {
  return { dedupeKey, id: `row-${dedupeKey}`, scheduledFor: at, status };
}

describe("reminder reconciliation", () => {
  it("reschedules the same pending row after a date change", () => {
    const changedDate = new Date("2026-05-08T00:00:00.000Z");
    const plan = planReminderReconciliation(
      [existing("stable-key")],
      [desired("stable-key", changedDate)],
    );

    assert.deepEqual(plan, {
      actions: [
        {
          deliveryId: "row-stable-key",
          kind: "RESCHEDULE",
          scheduledFor: changedDate,
        },
      ],
      unchanged: 0,
    });
  });

  it("cancels a scheduled offset removed from preferences", () => {
    assert.deepEqual(planReminderReconciliation([existing("removed")], []), {
      actions: [{ deliveryId: "row-removed", kind: "CANCEL" }],
      unchanged: 0,
    });
  });

  it("reactivates a cancelled stable key when a preference is re-enabled", () => {
    const plan = planReminderReconciliation(
      [existing("restored", "CANCELLED")],
      [desired("restored")],
    );

    assert.equal(plan.actions[0]?.kind, "REACTIVATE");
  });

  it("never mutates sent, processing, or failed deliveries", () => {
    for (const status of ["SENT", "PROCESSING", "FAILED"] as const) {
      const matching = planReminderReconciliation(
        [existing(status, status)],
        [desired(status, new Date("2027-01-01T00:00:00.000Z"))],
      );
      const stale = planReminderReconciliation([existing(status, status)], []);

      assert.deepEqual(matching.actions, []);
      assert.equal(matching.unchanged, 1);
      assert.deepEqual(stale.actions, []);
    }
  });

  it("is idempotent when the desired schedule is already persisted", () => {
    const first = planReminderReconciliation([existing("same")], [desired("same")]);
    const second = planReminderReconciliation([existing("same")], [desired("same")]);

    assert.deepEqual(first, { actions: [], unchanged: 1 });
    assert.deepEqual(second, first);
  });

  it("rejects duplicate desired keys before emitting writes", () => {
    assert.throws(
      () => planReminderReconciliation([], [desired("duplicate"), desired("duplicate")]),
      /Duplicate desired reminder key/u,
    );
  });
});
