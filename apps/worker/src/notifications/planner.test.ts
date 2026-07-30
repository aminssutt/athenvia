import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { planReminderDeliveries } from "./planner";
import { UTC_STORED_INSTANT_TIME_POLICY } from "./time-policy";
import type { WatchlistReminderSource } from "./types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WATCHLIST_ID = "22222222-2222-4222-8222-222222222222";
const WINDOW_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_WINDOW_ID = "44444444-4444-4444-8444-444444444444";

function source(overrides: Partial<WatchlistReminderSource> = {}): WatchlistReminderSource {
  return {
    applicationWindows: [
      {
        closesAt: new Date("2026-06-01T15:30:00.000Z"),
        id: WINDOW_ID,
        opensAt: new Date("2026-05-01T09:15:00.000Z"),
        publicStatus: "CONFIRMED",
      },
    ],
    hasActivePushSubscription: true,
    preference: {
      beforeDeadlineDays: [30, 14, 7, 2],
      beforeOpenDays: [30, 7],
      notifyOnOpen: true,
    },
    trackingStatus: "WATCHING",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
    ...overrides,
  };
}

describe("reminder planning", () => {
  it("plans the canonical opening and deadline defaults", () => {
    const planned = planReminderDeliveries(source(), {
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    assert.equal(planned.length, 7);
    assert.deepEqual(
      planned
        .filter(({ notificationType }) => notificationType === "APPLICATION_OPENING")
        .map(({ offsetDays }) => offsetDays)
        .sort((left, right) => right - left),
      [30, 7, 0],
    );
    assert.deepEqual(
      planned
        .filter(({ notificationType }) => notificationType === "APPLICATION_DEADLINE")
        .map(({ offsetDays }) => offsetDays)
        .sort((left, right) => right - left),
      [30, 14, 7, 2],
    );
  });

  it("uses fixed UTC instants across a European DST boundary", () => {
    const policy = UTC_STORED_INSTANT_TIME_POLICY;
    const beforeDstChange = policy.reminderAt(new Date("2026-03-30T01:30:00.000Z"), 2);

    assert.equal(policy.id, "stored-instant-utc-v1");
    assert.equal(policy.timeZone, "UTC");
    assert.equal(beforeDstChange.toISOString(), "2026-03-28T01:30:00.000Z");
    assert.equal(
      new Date("2026-03-30T01:30:00.000Z").getTime() - beforeDstChange.getTime(),
      48 * 60 * 60 * 1_000,
    );
  });

  it("ignores reminders in the past and exactly equal to now", () => {
    const planned = planReminderDeliveries(
      source({
        applicationWindows: [
          {
            closesAt: new Date("2026-04-03T00:00:00.000Z"),
            id: WINDOW_ID,
            opensAt: new Date("2026-04-01T00:00:00.000Z"),
            publicStatus: "EXPECTED",
          },
        ],
        preference: {
          beforeDeadlineDays: [2],
          beforeOpenDays: [],
          notifyOnOpen: true,
        },
      }),
      { now: new Date("2026-04-01T00:00:00.000Z") },
    );

    assert.deepEqual(planned, []);
  });

  it("does not let a malformed opening zero bypass notifyOnOpen=false", () => {
    const planned = planReminderDeliveries(
      source({
        preference: {
          beforeDeadlineDays: [],
          beforeOpenDays: [0, 7, 7, 9, -1, 7.5],
          notifyOnOpen: false,
        },
      }),
      { now: new Date("2026-01-01T00:00:00.000Z") },
    );

    assert.deepEqual(
      planned.map(({ offsetDays }) => offsetDays),
      [7],
    );
  });

  it("skips null and unpublished dates while supporting multiple rounds", () => {
    const planned = planReminderDeliveries(
      source({
        applicationWindows: [
          {
            closesAt: null,
            id: WINDOW_ID,
            opensAt: new Date("2026-05-01T09:15:00.000Z"),
            publicStatus: "EXPECTED",
          },
          {
            closesAt: new Date("2026-07-01T09:15:00.000Z"),
            id: OTHER_WINDOW_ID,
            opensAt: null,
            publicStatus: "CONFIRMED",
          },
          {
            closesAt: new Date("2026-08-01T09:15:00.000Z"),
            id: "55555555-5555-4555-8555-555555555555",
            opensAt: new Date("2026-07-01T09:15:00.000Z"),
            publicStatus: "NOT_PUBLISHED",
          },
        ],
        preference: {
          beforeDeadlineDays: [2],
          beforeOpenDays: [7],
          notifyOnOpen: false,
        },
      }),
      { now: new Date("2026-01-01T00:00:00.000Z") },
    );

    assert.equal(planned.length, 2);
    assert.deepEqual(
      planned.map(({ windowId }) => windowId).sort(),
      [OTHER_WINDOW_ID, WINDOW_ID].sort(),
    );
  });

  it("produces stable date-independent keys and deterministic output", () => {
    const initial = planReminderDeliveries(source(), {
      now: new Date("2026-01-01T00:00:00.000Z"),
    });
    const changed = planReminderDeliveries(
      source({
        applicationWindows: [
          {
            closesAt: new Date("2026-06-08T15:30:00.000Z"),
            id: WINDOW_ID,
            opensAt: new Date("2026-05-08T09:15:00.000Z"),
            publicStatus: "CONFIRMED",
          },
        ],
      }),
      { now: new Date("2026-01-01T00:00:00.000Z") },
    );

    assert.deepEqual(
      initial.map(({ dedupeKey }) => dedupeKey),
      changed.map(({ dedupeKey }) => dedupeKey),
    );
    assert.notDeepEqual(
      initial.map(({ scheduledFor }) => scheduledFor),
      changed.map(({ scheduledFor }) => scheduledFor),
    );
    assert.equal(new Set(initial.map(({ dedupeKey }) => dedupeKey)).size, initial.length);
  });

  it("plans nothing without an active subscription or after applying", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    assert.deepEqual(
      planReminderDeliveries(source({ hasActivePushSubscription: false }), { now }),
      [],
    );
    assert.deepEqual(planReminderDeliveries(source({ trackingStatus: "APPLIED" }), { now }), []);
  });

  it("rejects untrusted identifiers that could collide in dedupe keys", () => {
    assert.throws(
      () =>
        planReminderDeliveries(source({ watchlistId: `unsafe:${WATCHLIST_ID}` }), {
          now: new Date("2026-01-01T00:00:00.000Z"),
        }),
      /UUID/u,
    );
  });

  it("rejects an invalid planning clock", () => {
    assert.throws(
      () => planReminderDeliveries(source(), { now: new Date(Number.NaN) }),
      /valid now instant/u,
    );
  });
});
