import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { database } from "@athenvia/database";

import { planReminderReconciliation } from "./reconciliation";
import {
  PrismaReminderScheduleRepository,
  type AtomicReminderReconciliation,
  type ReminderScheduleRepository,
} from "./repository";
import {
  reconcileApplicationWindowSchedules,
  reconcileIntakeSchedules,
  reconcileUserSchedules,
  rescheduleWatchlistReminders,
  runReminderScheduleSweep,
} from "./scheduler";
import type {
  ExistingReminderDelivery,
  PlannedReminderDelivery,
  ReminderReconciliationResult,
  WatchlistReminderSource,
} from "./types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WATCHLIST_ID = "22222222-2222-4222-8222-222222222222";
const WINDOW_ID = "33333333-3333-4333-8333-333333333333";
const INTAKE_ID = "44444444-4444-4444-8444-444444444444";

function source(
  watchlistId = WATCHLIST_ID,
  overrides: Partial<WatchlistReminderSource> = {},
): WatchlistReminderSource {
  return {
    applicationWindows: [
      {
        closesAt: null,
        id: WINDOW_ID,
        opensAt: new Date("2026-05-01T09:00:00.000Z"),
        publicStatus: "CONFIRMED",
      },
    ],
    hasActivePushSubscription: true,
    preference: {
      beforeDeadlineDays: [],
      beforeOpenDays: [7],
      notifyOnOpen: false,
    },
    trackingStatus: "WATCHING",
    userId: USER_ID,
    watchlistId,
    ...overrides,
  };
}

class InMemoryReminderRepository implements ReminderScheduleRepository {
  readonly rows = new Map<string, ExistingReminderDelivery>();
  readonly sources = new Map<string, WatchlistReminderSource>();
  lastScope: "all" | "user" | "intake" | "window" | null = null;
  private rowSequence = 0;

  constructor(...sources: WatchlistReminderSource[]) {
    for (const item of sources) {
      this.sources.set(item.watchlistId, item);
    }
  }

  async listWatchlistIds(afterId?: string, limit = 100): Promise<string[]> {
    this.lastScope = "all";
    const ids = [...this.sources.keys()].sort();
    const nextIndex = afterId === undefined ? 0 : ids.findIndex((id) => id > afterId);
    const start = nextIndex === -1 ? ids.length : nextIndex;
    return ids.slice(start, start + limit);
  }

  async listWatchlistIdsForApplicationWindow(): Promise<string[]> {
    this.lastScope = "window";
    return [...this.sources.keys()].sort();
  }

  async listWatchlistIdsForIntake(): Promise<string[]> {
    this.lastScope = "intake";
    return [...this.sources.keys()].sort();
  }

  async listWatchlistIdsForUser(): Promise<string[]> {
    this.lastScope = "user";
    return [...this.sources.keys()].sort();
  }

  async reconcileWatchlistReminderDeliveries(
    watchlistId: string,
    planDesired: (current: WatchlistReminderSource) => readonly PlannedReminderDelivery[],
  ): Promise<AtomicReminderReconciliation | null> {
    const current = this.sources.get(watchlistId);
    if (current === undefined) {
      return null;
    }

    const desired = planDesired(current);
    const existing = [...this.rows.values()].filter(({ dedupeKey }) =>
      dedupeKey.includes(`:${watchlistId}:`),
    );
    const plan = planReminderReconciliation(existing, desired);
    const reconciliation: ReminderReconciliationResult = {
      cancelled: 0,
      created: 0,
      reactivated: 0,
      rescheduled: 0,
      unchanged: plan.unchanged,
    };

    for (const action of plan.actions) {
      if (action.kind === "CREATE") {
        this.rowSequence += 1;
        this.rows.set(action.delivery.dedupeKey, {
          dedupeKey: action.delivery.dedupeKey,
          id: `row-${this.rowSequence}`,
          scheduledFor: action.delivery.scheduledFor,
          status: "SCHEDULED",
        });
        reconciliation.created += 1;
        continue;
      }

      const row = [...this.rows.values()].find(({ id }) => id === action.deliveryId);
      assert.ok(row);
      if (action.kind === "CANCEL") {
        row.status = "CANCELLED";
        reconciliation.cancelled += 1;
      } else if (action.kind === "REACTIVATE") {
        row.status = "SCHEDULED";
        row.scheduledFor = action.scheduledFor;
        reconciliation.reactivated += 1;
      } else {
        row.scheduledFor = action.scheduledFor;
        reconciliation.rescheduled += 1;
      }
    }

    return {
      planned: desired.length,
      reconciliation,
    };
  }
}

describe("reminder scheduler", () => {
  it("updates one stable pending row when an application date changes", async () => {
    const repository = new InMemoryReminderRepository(source());
    const now = new Date("2026-01-01T00:00:00.000Z");
    const first = await rescheduleWatchlistReminders(WATCHLIST_ID, {
      now,
      repository,
    });
    const initialRow = [...repository.rows.values()][0];

    assert.equal(first.status, "RESCHEDULED");
    assert.equal(first.status === "RESCHEDULED" && first.reconciliation.created, 1);
    assert.ok(initialRow);

    repository.sources.set(
      WATCHLIST_ID,
      source(WATCHLIST_ID, {
        applicationWindows: [
          {
            closesAt: null,
            id: WINDOW_ID,
            opensAt: new Date("2026-05-08T09:00:00.000Z"),
            publicStatus: "CONFIRMED",
          },
        ],
      }),
    );
    const second = await rescheduleWatchlistReminders(WATCHLIST_ID, {
      now,
      repository,
    });
    const changedRow = [...repository.rows.values()][0];

    assert.equal(second.status, "RESCHEDULED");
    assert.equal(second.status === "RESCHEDULED" && second.reconciliation.rescheduled, 1);
    assert.equal(repository.rows.size, 1);
    assert.equal(changedRow?.id, initialRow.id);
    assert.equal(changedRow?.scheduledFor.toISOString(), "2026-05-01T09:00:00.000Z");
  });

  it("cancels removed preferences and reactivates the same row without duplicates", async () => {
    const repository = new InMemoryReminderRepository(source());
    const options = {
      now: new Date("2026-01-01T00:00:00.000Z"),
      repository,
    };
    await rescheduleWatchlistReminders(WATCHLIST_ID, options);
    const initialId = [...repository.rows.values()][0]?.id;

    repository.sources.set(
      WATCHLIST_ID,
      source(WATCHLIST_ID, {
        preference: {
          beforeDeadlineDays: [],
          beforeOpenDays: [],
          notifyOnOpen: false,
        },
      }),
    );
    const removed = await rescheduleWatchlistReminders(WATCHLIST_ID, options);
    assert.equal(removed.status === "RESCHEDULED" && removed.reconciliation.cancelled, 1);
    assert.equal([...repository.rows.values()][0]?.status, "CANCELLED");

    repository.sources.set(WATCHLIST_ID, source());
    const restored = await rescheduleWatchlistReminders(WATCHLIST_ID, options);
    assert.equal(restored.status === "RESCHEDULED" && restored.reconciliation.reactivated, 1);
    assert.equal(repository.rows.size, 1);
    assert.equal([...repository.rows.values()][0]?.id, initialId);
  });

  it("cancels pending reminders when the active subscription disappears", async () => {
    const repository = new InMemoryReminderRepository(source());
    const options = {
      now: new Date("2026-01-01T00:00:00.000Z"),
      repository,
    };
    await rescheduleWatchlistReminders(WATCHLIST_ID, options);
    repository.sources.set(
      WATCHLIST_ID,
      source(WATCHLIST_ID, { hasActivePushSubscription: false }),
    );

    const result = await rescheduleWatchlistReminders(WATCHLIST_ID, options);

    assert.equal(result.status === "RESCHEDULED" && result.reconciliation.cancelled, 1);
  });

  it("returns NOT_FOUND without attempting a reconciliation plan", async () => {
    const repository = new InMemoryReminderRepository();
    const result = await rescheduleWatchlistReminders(WATCHLIST_ID, {
      repository,
    });

    assert.deepEqual(result, { status: "NOT_FOUND", watchlistId: WATCHLIST_ID });
  });

  it("uses bounded pagination and exposes user/intake/window trigger scopes", async () => {
    const ids = [
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000003",
    ];
    const repository = new InMemoryReminderRepository(
      ...ids.map((id) =>
        source(id, {
          hasActivePushSubscription: false,
        }),
      ),
    );
    const common = {
      now: new Date("2026-01-01T00:00:00.000Z"),
      repository,
    };

    const sweep = await runReminderScheduleSweep({ ...common, batchSize: 2 });
    assert.equal(sweep.watchlists, 3);
    assert.equal(repository.lastScope, "all");

    assert.equal((await reconcileUserSchedules(USER_ID, common)).watchlists, 3);
    assert.equal(repository.lastScope, "user");
    assert.equal((await reconcileIntakeSchedules(INTAKE_ID, common)).watchlists, 3);
    assert.equal(repository.lastScope, "intake");
    assert.equal((await reconcileApplicationWindowSchedules(WINDOW_ID, common)).watchlists, 3);
    assert.equal(repository.lastScope, "window");
  });

  it("rejects unsafe sweep page sizes", async () => {
    const repository = new InMemoryReminderRepository(source());
    await assert.rejects(runReminderScheduleSweep({ batchSize: 0, repository }), RangeError);
    await assert.rejects(runReminderScheduleSweep({ batchSize: 1_001, repository }), RangeError);
  });
});

describe("Prisma reminder repository transaction order", () => {
  it("uses deletion-safe keyset pagination instead of a cursor row", async () => {
    let receivedQuery: unknown;
    const fakeClient = {
      userWatchlist: {
        findMany: async (query: unknown) => {
          receivedQuery = query;
          return [];
        },
      },
    };
    const repository = new PrismaReminderScheduleRepository(
      fakeClient as unknown as typeof database,
    );

    await repository.listWatchlistIds(WATCHLIST_ID, 25);

    assert.deepEqual(receivedQuery, {
      orderBy: { id: "asc" },
      select: { id: true },
      take: 25,
      where: { id: { gt: WATCHLIST_ID } },
    });
  });

  it("locks first, then loads current source, then invokes the planner", async () => {
    const calls: string[] = [];
    let opensAt = new Date("2026-05-01T09:00:00.000Z");
    const transaction = {
      $queryRaw: async () => {
        calls.push("lock");
        opensAt = new Date("2026-05-08T09:00:00.000Z");
        return [];
      },
      notificationDelivery: {
        createMany: async () => ({ count: 0 }),
        findMany: async () => {
          calls.push("existing");
          return [];
        },
        updateMany: async () => ({ count: 0 }),
      },
      userWatchlist: {
        findUnique: async () => {
          calls.push("load-current");
          return {
            id: WATCHLIST_ID,
            intake: {
              applicationWindows: [
                {
                  closesAt: null,
                  id: WINDOW_ID,
                  opensAt,
                  publicStatus: "CONFIRMED",
                },
              ],
            },
            notificationPreference: {
              beforeDeadlineDays: [],
              beforeOpenDays: [7],
              notifyOnOpen: false,
            },
            trackingStatus: "WATCHING",
            user: { pushSubscriptions: [{ id: "subscription" }] },
            userId: USER_ID,
          };
        },
      },
    };
    const fakeClient = {
      $transaction: async <T>(callback: (client: typeof transaction) => Promise<T>): Promise<T> =>
        callback(transaction),
    };
    const repository = new PrismaReminderScheduleRepository(
      fakeClient as unknown as typeof database,
    );

    const result = await repository.reconcileWatchlistReminderDeliveries(
      WATCHLIST_ID,
      (current) => {
        calls.push("plan-current");
        assert.equal(
          current.applicationWindows[0]?.opensAt?.toISOString(),
          "2026-05-08T09:00:00.000Z",
        );
        return [];
      },
    );

    assert.deepEqual(calls, ["lock", "load-current", "plan-current", "existing"]);
    assert.deepEqual(result, {
      planned: 0,
      reconciliation: {
        cancelled: 0,
        created: 0,
        reactivated: 0,
        rescheduled: 0,
        unchanged: 0,
      },
    });
  });
});
