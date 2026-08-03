import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDateChangeDeliveryPlan,
  DateChangeNotificationError,
  parseDateChangeDedupeKey,
  planDateChangeNotifications,
  prepareDateChangeNotificationJobByDeliveryId,
  validateApprovedDateChange,
  type ApprovedDateChangeRevision,
  type DateChangeDeliveryRecord,
  type DateChangeNotificationRepository,
  type DateChangePlanningRepositoryResult,
  type DateChangeWatchlistCandidate,
} from "../src/notifications/date-change-notifications";
import { planReminderReconciliation } from "../src/notifications/reconciliation";
import type {
  AtomicReminderReconciliation,
  ReminderScheduleRepository,
} from "../src/notifications/repository";
import {
  reconcileApplicationWindowSchedules,
  rescheduleWatchlistReminders,
  runReminderScheduleSweep,
} from "../src/notifications/scheduler";
import type {
  PlannedReminderDelivery,
  ReminderDeliveryStatus,
  ReminderPublicDateStatus,
  ReminderReconciliationResult,
  WatchlistReminderSource,
} from "../src/notifications/types";
import {
  dispatchDueNotificationDeliveries,
  PrismaClaimedNotificationPreparer,
  processNotificationDeliveryJob,
  type ClaimedDeliveryIdentity,
  type DeliveryQueue,
  type NotificationDeliveryRepository,
  type ProcessingDeliveryClaim,
} from "../src/notification-delivery";
import {
  notificationDeliveryQueueContract,
  type NotificationDeliveryJobData,
} from "../src/queue-contracts";
import type { ActivePushSubscription, NotificationTransport } from "../src/web-push-transport";

import type { NotificationPayload } from "@athenvia/contracts";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WATCHLIST_ID = "22222222-2222-4222-8222-222222222222";
const WINDOW_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const UNIVERSITY_ID = "55555555-5555-4555-8555-555555555555";
const INTAKE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const SNAPSHOT_ID = "88888888-8888-4888-8888-888888888888";
const REVISION_ID = "66666666-6666-4666-8666-666666666666";
const NEWER_REVISION_ID = "66666666-6666-4666-8666-666666666667";

const NOW = new Date("2027-01-10T12:00:00.000Z");
const REVIEWED_AT = new Date("2027-01-10T10:00:00.000Z");
const OLD_OPENS_AT = new Date("2027-03-01T00:00:00.000Z");
const NEW_OPENS_AT = new Date("2027-03-05T00:00:00.000Z");
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

type StoredNotificationType =
  "APPLICATION_OPENING" | "APPLICATION_DEADLINE" | "DATE_CHANGED" | "SUBMISSION_APPROVED";

interface DeliveryRow {
  dedupeKey: string;
  errorMessage: string | null;
  id: string;
  notificationType: StoredNotificationType;
  scheduledFor: Date;
  sentAt: Date | null;
  status: ReminderDeliveryStatus;
  userId: string;
  watchlistId: string;
}

interface RevisionRegistryRow {
  changeStatus: "APPROVED" | "PENDING" | "REJECTED";
  conflictKey: string | null;
  entityId: string;
  entityType: string;
  fieldName: string;
  newValue: unknown;
  oldValue: unknown;
  reviewedAt: Date | null;
  revisionId: string;
}

/**
 * The mutable canonical state a verified date change is applied to. The
 * repositories below derive canonicalValue/publicStatus from this window
 * exactly like the Prisma repositories derive them from the database row.
 */
interface World {
  pushSubscriptions: ActivePushSubscription[];
  revisions: Map<string, RevisionRegistryRow>;
  window: {
    closesAt: Date | null;
    opensAt: Date | null;
    publicStatus: ReminderPublicDateStatus;
  };
}

function createWorld(): World {
  return {
    pushSubscriptions: [
      {
        auth: "auth-secret-one",
        endpoint: "https://push.example.test/one",
        id: "push-one",
        p256dh: "p256dh-secret-one",
      },
    ],
    revisions: new Map(),
    window: { closesAt: null, opensAt: OLD_OPENS_AT, publicStatus: "CONFIRMED" },
  };
}

function approvedRevisionRow(overrides: Partial<RevisionRegistryRow> = {}): RevisionRegistryRow {
  return {
    changeStatus: "APPROVED",
    conflictKey: `APPLICATION_WINDOW:${WINDOW_ID}:opensAt`,
    entityId: WINDOW_ID,
    entityType: "APPLICATION_WINDOW",
    fieldName: "opensAt",
    newValue: "2027-03-05",
    oldValue: "2027-03-01",
    reviewedAt: REVIEWED_AT,
    revisionId: REVISION_ID,
    ...overrides,
  };
}

function watchlistCandidate(world: World): DateChangeWatchlistCandidate {
  return {
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
    hasActivePushSubscription: world.pushSubscriptions.length > 0,
    intakeId: INTAKE_ID,
    intakeProgramId: PROGRAM_ID,
    notifyOnDateChange: true,
    programId: PROGRAM_ID,
    programStatus: "ACTIVE",
    trackingStatus: "WATCHING",
    universityStatus: "ACTIVE",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
  };
}

function hydrateRevision(world: World, revisionId: string): ApprovedDateChangeRevision | null {
  const row = world.revisions.get(revisionId);
  if (row === undefined) {
    return null;
  }
  const approvedSiblings = [...world.revisions.values()].filter(
    (candidate) =>
      candidate.changeStatus === "APPROVED" &&
      candidate.entityId === row.entityId &&
      candidate.entityType === row.entityType &&
      candidate.fieldName === row.fieldName &&
      candidate.reviewedAt !== null,
  );
  const latest = approvedSiblings.reduce<RevisionRegistryRow | null>(
    (best, candidate) =>
      best === null || (candidate.reviewedAt?.getTime() ?? 0) > (best.reviewedAt?.getTime() ?? 0)
        ? candidate
        : best,
    null,
  );
  const hasUnresolvedConflict = [...world.revisions.values()].some(
    (candidate) =>
      candidate.changeStatus === "PENDING" &&
      candidate.conflictKey === `APPLICATION_WINDOW:${row.entityId}:${row.fieldName}` &&
      candidate.revisionId !== row.revisionId,
  );
  return {
    canonicalValue: row.fieldName === "opensAt" ? world.window.opensAt : world.window.closesAt,
    changeStatus: row.changeStatus,
    conflictKey: row.conflictKey,
    entityId: row.entityId,
    entityType: row.entityType,
    fieldName: row.fieldName,
    hasConflict: false,
    hasNewerApprovedRevision: latest !== null && latest.revisionId !== row.revisionId,
    hasUnresolvedConflict,
    intakeId: INTAKE_ID,
    newValue: row.newValue,
    oldValue: row.oldValue,
    programId: PROGRAM_ID,
    programName: "MSc Artificial Intelligence",
    publicStatus: world.window.publicStatus,
    revisionId: row.revisionId,
    reviewedAt: row.reviewedAt,
    sourceId: SOURCE_ID,
    sourceIsOfficial: true,
    sourceProgramId: PROGRAM_ID,
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSnapshotSourceId: SOURCE_ID,
    sourceUniversityId: UNIVERSITY_ID,
    sourceUrl: "https://admissions.example.edu/program",
    universityId: UNIVERSITY_ID,
    universityName: "Example University",
    watchlists: [watchlistCandidate(world)],
  };
}

/**
 * Shared delivery table. Insertion mirrors the schema's unique dedupeKey with
 * createMany({ skipDuplicates: true }) semantics; state transitions mirror the
 * status-guarded updateMany calls of the Prisma repositories.
 */
class InMemoryDeliveryStore {
  readonly rows = new Map<string, DeliveryRow>();
  private sequence = 0;

  nextId(): string {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${String(this.sequence).padStart(12, "0")}`;
  }

  insertManySkipDuplicates(
    data: Array<{
      dedupeKey: string;
      notificationType: StoredNotificationType;
      scheduledFor: Date;
      status: "SCHEDULED";
      userId: string;
      watchlistId: string;
    }>,
  ): number {
    let created = 0;
    for (const entry of data) {
      const duplicate = [...this.rows.values()].some((row) => row.dedupeKey === entry.dedupeKey);
      if (duplicate) {
        continue;
      }
      const id = this.nextId();
      this.rows.set(id, {
        dedupeKey: entry.dedupeKey,
        errorMessage: null,
        id,
        notificationType: entry.notificationType,
        scheduledFor: new Date(entry.scheduledFor.getTime()),
        sentAt: null,
        status: entry.status,
        userId: entry.userId,
        watchlistId: entry.watchlistId,
      });
      created += 1;
    }
    return created;
  }

  byDedupeKey(dedupeKey: string): DeliveryRow | undefined {
    return [...this.rows.values()].find((row) => row.dedupeKey === dedupeKey);
  }

  ofType(notificationType: StoredNotificationType): DeliveryRow[] {
    return [...this.rows.values()].filter((row) => row.notificationType === notificationType);
  }
}

function isIgnoredPlanningCode(code: string): boolean {
  return code === "NOT_MATERIAL" || code === "BOTH_DATES_PAST";
}

class InMemoryDateChangeRepository implements DateChangeNotificationRepository {
  constructor(
    private readonly world: World,
    private readonly store: InMemoryDeliveryStore,
  ) {}

  async planApprovedDateChange(
    revisionId: string,
    now: Date,
  ): Promise<DateChangePlanningRepositoryResult> {
    const revision = hydrateRevision(this.world, revisionId);
    if (revision === null) {
      return { revisionId, status: "NOT_FOUND" };
    }
    let planningError: DateChangeNotificationError | null = null;
    try {
      validateApprovedDateChange(revision, now);
    } catch (error) {
      if (!(error instanceof DateChangeNotificationError)) {
        throw error;
      }
      planningError = error;
    }
    let cancelledStaleCount = 0;
    const canCancelSuperseded =
      revision.changeStatus === "APPROVED" && !revision.hasNewerApprovedRevision;
    if (canCancelSuperseded) {
      const watchlistIds = new Set(revision.watchlists.map(({ watchlistId }) => watchlistId));
      for (const row of this.store.ofType("DATE_CHANGED")) {
        if (row.status !== "SCHEDULED" || !watchlistIds.has(row.watchlistId)) {
          continue;
        }
        const parsed = parseDateChangeDedupeKey(row.dedupeKey);
        if (parsed === null || parsed.revisionId === revision.revisionId) {
          continue;
        }
        const superseded = this.world.revisions.get(parsed.revisionId);
        if (
          superseded !== undefined &&
          superseded.entityType === revision.entityType &&
          superseded.entityId === revision.entityId &&
          superseded.fieldName === revision.fieldName
        ) {
          row.status = "CANCELLED";
          cancelledStaleCount += 1;
        }
      }
    }
    if (planningError !== null) {
      return {
        cancelledStaleCount,
        code: planningError.code,
        revisionId,
        status: isIgnoredPlanningCode(planningError.code) ? "IGNORED" : "REJECTED",
      };
    }
    const deliveries = buildDateChangeDeliveryPlan(revision, now);
    const createdCount = this.store.insertManySkipDuplicates(deliveries);
    return {
      cancelledStaleCount,
      createdCount,
      eligibleCount: deliveries.length,
      revisionId,
      status: "PLANNED",
    };
  }

  async findDateChangeDeliveryRecord(deliveryId: string): Promise<DateChangeDeliveryRecord | null> {
    const row = this.store.rows.get(deliveryId);
    if (row === undefined) {
      return null;
    }
    const parsed = parseDateChangeDedupeKey(row.dedupeKey);
    return {
      dedupeKey: row.dedupeKey,
      deliveryId: row.id,
      notificationType: row.notificationType,
      revision: parsed === null ? null : hydrateRevision(this.world, parsed.revisionId),
      scheduledFor: row.scheduledFor,
      status: row.status,
      userId: row.userId,
      watchlist: watchlistCandidate(this.world),
      watchlistId: row.watchlistId,
    };
  }

  async listDueDateChangeDeliveryRecords(
    now: Date,
    limit: number,
  ): Promise<DateChangeDeliveryRecord[]> {
    const due = this.store
      .ofType("DATE_CHANGED")
      .filter((row) => row.status === "SCHEDULED" && row.scheduledFor.getTime() <= now.getTime())
      .slice(0, limit);
    const records: DateChangeDeliveryRecord[] = [];
    for (const row of due) {
      const record = await this.findDateChangeDeliveryRecord(row.id);
      if (record !== null) {
        records.push(record);
      }
    }
    return records;
  }
}

class InMemoryReminderScheduleRepository implements ReminderScheduleRepository {
  constructor(
    private readonly world: World,
    private readonly store: InMemoryDeliveryStore,
  ) {}

  private source(): WatchlistReminderSource {
    return {
      applicationWindows: [
        {
          closesAt: this.world.window.closesAt,
          id: WINDOW_ID,
          opensAt: this.world.window.opensAt,
          publicStatus: this.world.window.publicStatus,
        },
      ],
      hasActivePushSubscription: this.world.pushSubscriptions.length > 0,
      preference: {
        beforeDeadlineDays: [],
        beforeOpenDays: [30, 7],
        notifyOnOpen: true,
      },
      trackingStatus: "WATCHING",
      userId: USER_ID,
      watchlistId: WATCHLIST_ID,
    };
  }

  async listWatchlistIds(): Promise<string[]> {
    return [WATCHLIST_ID];
  }

  async listWatchlistIdsForApplicationWindow(): Promise<string[]> {
    return [WATCHLIST_ID];
  }

  async listWatchlistIdsForIntake(): Promise<string[]> {
    return [WATCHLIST_ID];
  }

  async listWatchlistIdsForUser(): Promise<string[]> {
    return [WATCHLIST_ID];
  }

  async reconcileWatchlistReminderDeliveries(
    watchlistId: string,
    planDesired: (source: WatchlistReminderSource) => readonly PlannedReminderDelivery[],
  ): Promise<AtomicReminderReconciliation | null> {
    if (watchlistId !== WATCHLIST_ID) {
      return null;
    }
    const desired = planDesired(this.source());
    const managedPrefix = `athenvia:reminder:v1:${watchlistId}:`;
    const existing = [...this.store.rows.values()].filter((row) =>
      row.dedupeKey.startsWith(managedPrefix),
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
      if (action.kind === "CANCEL") {
        const row = this.store.rows.get(action.deliveryId);
        if (row !== undefined && row.status === "SCHEDULED") {
          row.status = "CANCELLED";
          reconciliation.cancelled += 1;
        }
        continue;
      }
      if (action.kind === "REACTIVATE") {
        const row = this.store.rows.get(action.deliveryId);
        if (row !== undefined && row.status === "CANCELLED") {
          row.errorMessage = null;
          row.scheduledFor = new Date(action.scheduledFor.getTime());
          row.status = "SCHEDULED";
          reconciliation.reactivated += 1;
        }
        continue;
      }
      if (action.kind === "RESCHEDULE") {
        const row = this.store.rows.get(action.deliveryId);
        if (row !== undefined && row.status === "SCHEDULED") {
          row.errorMessage = null;
          row.scheduledFor = new Date(action.scheduledFor.getTime());
          reconciliation.rescheduled += 1;
        }
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
    reconciliation.created = this.store.insertManySkipDuplicates(creates);
    return { planned: desired.length, reconciliation };
  }
}

class InMemoryNotificationDeliveryRepository implements NotificationDeliveryRepository {
  constructor(
    private readonly world: World,
    private readonly store: InMemoryDeliveryStore,
  ) {}

  async listDueScheduledDeliveryIds(now: Date, limit: number): Promise<string[]> {
    return [...this.store.rows.values()]
      .filter((row) => row.status === "SCHEDULED" && row.scheduledFor.getTime() <= now.getTime())
      .sort(
        (left, right) =>
          left.scheduledFor.getTime() - right.scheduledFor.getTime() ||
          left.id.localeCompare(right.id),
      )
      .slice(0, limit)
      .map(({ id }) => id);
  }

  async listProcessingDeliveryClaims(limit: number): Promise<ProcessingDeliveryClaim[]> {
    return [...this.store.rows.values()]
      .filter((row) => row.status === "PROCESSING")
      .slice(0, limit)
      .map((row) => ({ deliveryId: row.id, marker: row.errorMessage }));
  }

  async claimScheduledDelivery(
    deliveryId: string,
    claimedAt: Date,
    marker: string,
  ): Promise<boolean> {
    const row = this.store.rows.get(deliveryId);
    if (
      row === undefined ||
      row.status !== "SCHEDULED" ||
      row.scheduledFor.getTime() > claimedAt.getTime()
    ) {
      return false;
    }
    row.errorMessage = marker;
    row.sentAt = null;
    row.status = "PROCESSING";
    return true;
  }

  async loadClaimedDeliveryIdentity(
    deliveryId: string,
    marker: string,
  ): Promise<ClaimedDeliveryIdentity | null> {
    const row = this.store.rows.get(deliveryId);
    if (row === undefined || row.status !== "PROCESSING" || row.errorMessage !== marker) {
      return null;
    }
    return {
      notificationType: row.notificationType as ClaimedDeliveryIdentity["notificationType"],
      userId: row.userId,
    };
  }

  async listActivePushSubscriptions(): Promise<ActivePushSubscription[]> {
    return this.world.pushSubscriptions;
  }

  async promoteClaimToSending(
    deliveryId: string,
    claimedMarker: string,
    sendingMarker: string,
  ): Promise<boolean> {
    const row = this.store.rows.get(deliveryId);
    if (row === undefined || row.status !== "PROCESSING" || row.errorMessage !== claimedMarker) {
      return false;
    }
    row.errorMessage = sendingMarker;
    return true;
  }

  async finalizeClaimedDelivery(
    deliveryId: string,
    marker: string | null,
    status: "CANCELLED" | "FAILED" | "SENT",
    completedAt: Date,
    safeMessage: string | null,
  ): Promise<boolean> {
    const row = this.store.rows.get(deliveryId);
    if (row === undefined || row.status !== "PROCESSING" || row.errorMessage !== marker) {
      return false;
    }
    row.errorMessage = safeMessage;
    row.sentAt = status === "SENT" ? completedAt : null;
    row.status = status;
    return true;
  }

  async resetStaleClaimedDelivery(
    deliveryId: string,
    claimedMarker: string,
    safeMessage: string,
  ): Promise<boolean> {
    const row = this.store.rows.get(deliveryId);
    if (row === undefined || row.status !== "PROCESSING" || row.errorMessage !== claimedMarker) {
      return false;
    }
    row.errorMessage = safeMessage;
    row.sentAt = null;
    row.status = "SCHEDULED";
    return true;
  }

  async revokeInvalidPushSubscriptions(
    _userId: string,
    subscriptionIds: string[],
  ): Promise<number> {
    const revoked = new Set(subscriptionIds);
    this.world.pushSubscriptions = this.world.pushSubscriptions.filter(
      ({ id }) => !revoked.has(id),
    );
    return subscriptionIds.length;
  }
}

class RecordingTransport implements NotificationTransport {
  readonly sentPayloads: NotificationPayload[] = [];

  async send(_subscription: ActivePushSubscription, payload: NotificationPayload): Promise<void> {
    this.sentPayloads.push(payload);
  }
}

function createQueue(): { jobs: Map<string, NotificationDeliveryJobData>; queue: DeliveryQueue } {
  const jobs = new Map<string, NotificationDeliveryJobData>();
  const queue: DeliveryQueue = {
    add: async (_name, data, options) => {
      if (!jobs.has(options.jobId)) {
        jobs.set(options.jobId, data);
      }
      return jobs.get(options.jobId);
    },
  };
  return { jobs, queue };
}

function createHarness() {
  const world = createWorld();
  const store = new InMemoryDeliveryStore();
  const dateChangeRepository = new InMemoryDateChangeRepository(world, store);
  const reminderRepository = new InMemoryReminderScheduleRepository(world, store);
  const deliveryRepository = new InMemoryNotificationDeliveryRepository(world, store);
  const preparer = new PrismaClaimedNotificationPreparer(undefined, {
    dateChange: dateChangeRepository,
    deadline: {
      findDeadlineReminderRecord: async () => null,
    },
    opening: {
      findOpeningReminderRecord: async () => null,
    },
  });
  return { dateChangeRepository, deliveryRepository, preparer, reminderRepository, store, world };
}

function applyVerifiedChange(world: World, row: RevisionRegistryRow = approvedRevisionRow()): void {
  world.revisions.set(row.revisionId, row);
  world.window.opensAt = NEW_OPENS_AT;
}

describe("verified date change end to end", () => {
  describe("criterion 1: the revision preserves the previous verified value", () => {
    it("keeps the previous date in the approved revision and surfaces it to the user", async () => {
      const { dateChangeRepository, store, world } = createHarness();
      applyVerifiedChange(world);

      const planned = await planDateChangeNotifications(REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.deepEqual(planned, {
        cancelledStaleCount: 0,
        createdCount: 1,
        eligibleCount: 1,
        revisionId: REVISION_ID,
        status: "PLANNED",
      });

      const delivery = store.byDedupeKey(`athenvia:date-change:v1:${WATCHLIST_ID}:${REVISION_ID}`);
      assert.ok(delivery, "the planned delivery must exist under the stable dedupe key");
      const prepared = await prepareDateChangeNotificationJobByDeliveryId(delivery.id, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.equal(prepared.status, "READY");
      assert.ok(prepared.status === "READY");
      // The consultable history: the old canonical value survives in the
      // revision and drives the user-facing copy alongside the new value.
      assert.equal(prepared.job.change.oldDate, OLD_OPENS_AT.toISOString());
      assert.equal(prepared.job.change.newDate, NEW_OPENS_AT.toISOString());
      assert.equal(prepared.job.change.kind, "MOVED");
      assert.match(prepared.job.payload.body, /from March 1, 2027 to March 5, 2027/u);
    });

    it("rejects an approved revision whose previous value was corrupted", async () => {
      const { dateChangeRepository, world } = createHarness();
      applyVerifiedChange(world, approvedRevisionRow({ oldValue: 12345 }));

      const planned = await planDateChangeNotifications(REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.equal(planned.status, "REJECTED");
      assert.ok(planned.status === "REJECTED");
      assert.equal(planned.code, "INVALID_RECORD");
    });

    it("rejects an approved revision that was never applied to the canonical window", async () => {
      // The admin approval path (apps/web/app/api/admin/reviews/service.ts)
      // applies newValue to ApplicationWindow in the same transaction, but if
      // a revision is ever approved without that publication step, planning
      // must treat it as stale rather than notify about a date users cannot
      // see.
      const { dateChangeRepository, world } = createHarness();
      world.revisions.set(REVISION_ID, approvedRevisionRow());
      // world.window.opensAt intentionally still OLD_OPENS_AT.

      const planned = await planDateChangeNotifications(REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.equal(planned.status, "REJECTED");
      assert.ok(planned.status === "REJECTED");
      assert.equal(planned.code, "CANONICAL_VALUE_STALE");
    });

    it.todo(
      "MISSING LINK: no code path creates an APPLICATION_WINDOW opensAt/closesAt DataRevision " +
        "that snapshots the previous canonical value at write time (no producer exists in " +
        "apps/worker or apps/web), so the verified-change history chain cannot start in production",
    );

    // The former approval gap is closed: the web admin decision applies
    // newValue to the ApplicationWindow atomically (service.ts) and the
    // worker's runDateChangePlanningSweep feeds approved revisions to
    // planDateChangeNotifications (apps/worker/src/notifications/README.md).
  });

  describe("criterion 2: pending reminders are recalculated onto the new date", () => {
    it("reschedules the same pending rows onto the new date instead of duplicating them", async () => {
      const { reminderRepository, store, world } = createHarness();

      const seeded = await rescheduleWatchlistReminders(WATCHLIST_ID, {
        now: NOW,
        repository: reminderRepository,
      });
      assert.equal(seeded.status, "RESCHEDULED");
      assert.ok(seeded.status === "RESCHEDULED");
      // beforeOpenDays [30, 7] plus notifyOnOpen day-of => three reminders.
      assert.equal(seeded.reconciliation.created, 3);
      const seededIdByKey = new Map([...store.rows.values()].map((row) => [row.dedupeKey, row.id]));

      // The verified change is applied to the canonical window, then the
      // application-window trigger recalculates every follower.
      applyVerifiedChange(world);
      const result = await reconcileApplicationWindowSchedules(WINDOW_ID, {
        now: NOW,
        repository: reminderRepository,
      });
      assert.deepEqual(result.reconciliation, {
        cancelled: 0,
        created: 0,
        reactivated: 0,
        rescheduled: 3,
        unchanged: 0,
      });

      assert.equal(store.rows.size, 3, "no duplicate reminder rows may appear");
      for (const [offsetDays, expected] of [
        [30, new Date(NEW_OPENS_AT.getTime() - 30 * DAY_MILLISECONDS)],
        [7, new Date(NEW_OPENS_AT.getTime() - 7 * DAY_MILLISECONDS)],
        [0, NEW_OPENS_AT],
      ] as const) {
        const dedupeKey = `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:${offsetDays}`;
        const row = store.byDedupeKey(dedupeKey);
        assert.ok(row, `reminder ${dedupeKey} must still exist`);
        assert.equal(row.id, seededIdByKey.get(dedupeKey), "the same persisted row is updated");
        assert.equal(row.status, "SCHEDULED");
        assert.deepEqual(row.scheduledFor, expected);
      }
    });

    it("cancels a reminder whose recalculated instant is already in the past", async () => {
      const { reminderRepository, store, world } = createHarness();
      await rescheduleWatchlistReminders(WATCHLIST_ID, {
        now: NOW,
        repository: reminderRepository,
      });

      // A verified correction pulls the opening to February 1: the 30-day
      // reminder now falls before "now" and must be cancelled, not duplicated.
      world.window.opensAt = new Date("2027-02-01T00:00:00.000Z");
      const result = await reconcileApplicationWindowSchedules(WINDOW_ID, {
        now: NOW,
        repository: reminderRepository,
      });
      assert.deepEqual(result.reconciliation, {
        cancelled: 1,
        created: 0,
        reactivated: 0,
        rescheduled: 2,
        unchanged: 0,
      });
      assert.equal(store.rows.size, 3);
      assert.equal(
        store.byDedupeKey(`athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:30`)?.status,
        "CANCELLED",
      );
    });

    it("recalculates through the server-side sweep when no trigger was invoked", async () => {
      // The write paths are not wired to the reconciliation entry points yet
      // (apps/worker/src/notifications/README.md); the bounded sweep is the
      // safety net that must eventually capture a missed date change.
      const { reminderRepository, store, world } = createHarness();
      await rescheduleWatchlistReminders(WATCHLIST_ID, {
        now: NOW,
        repository: reminderRepository,
      });
      applyVerifiedChange(world);

      const sweep = await runReminderScheduleSweep({
        now: NOW,
        repository: reminderRepository,
      });
      assert.equal(sweep.watchlists, 1);
      assert.equal(sweep.reconciliation.rescheduled, 3);
      assert.equal(sweep.reconciliation.created, 0);
      assert.deepEqual(
        store.byDedupeKey(`athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:0`)
          ?.scheduledFor,
        NEW_OPENS_AT,
      );
    });

    it.todo(
      "MISSING LINK: no application-date write path calls reconcileApplicationWindowSchedules " +
        "or enqueues an equivalent job when a verified date change is applied; only the " +
        "periodic runReminderScheduleSweep eventually recalculates reminders",
    );
  });

  describe("criterion 3: affected users are not notified twice", () => {
    it("leaves an already-sent reminder untouched after the date changes", async () => {
      const { reminderRepository, store, world } = createHarness();
      await rescheduleWatchlistReminders(WATCHLIST_ID, {
        now: NOW,
        repository: reminderRepository,
      });

      // The 30-day reminder was already delivered for the old date.
      const sentKey = `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:30`;
      const sentRow = store.byDedupeKey(sentKey);
      assert.ok(sentRow);
      const sentScheduledFor = new Date(sentRow.scheduledFor.getTime());
      sentRow.sentAt = NOW;
      sentRow.status = "SENT";

      applyVerifiedChange(world);
      const result = await reconcileApplicationWindowSchedules(WINDOW_ID, {
        now: NOW,
        repository: reminderRepository,
      });

      // The SENT row is immutable for the scheduler and, because dates are not
      // part of the dedupe key, the recalculated desired reminder maps onto
      // that same row instead of creating a second one.
      assert.deepEqual(result.reconciliation, {
        cancelled: 0,
        created: 0,
        reactivated: 0,
        rescheduled: 2,
        unchanged: 1,
      });
      assert.equal(store.rows.size, 3);
      const after = store.byDedupeKey(sentKey);
      assert.ok(after);
      assert.equal(after.status, "SENT");
      assert.deepEqual(after.sentAt, NOW);
      assert.deepEqual(after.scheduledFor, sentScheduledFor);
    });

    it("plans, delivers exactly once, and stays idempotent across replans and redeliveries", async () => {
      const { dateChangeRepository, deliveryRepository, preparer, store, world } = createHarness();
      applyVerifiedChange(world);

      const first = await planDateChangeNotifications(REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.ok(first.status === "PLANNED");
      assert.equal(first.createdCount, 1);

      // Re-running the planner (retry, duplicate queue job) creates nothing:
      // the unique dedupe key already exists.
      const replanned = await planDateChangeNotifications(REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.ok(replanned.status === "PLANNED");
      assert.equal(replanned.createdCount, 0);

      // Dispatch is also idempotent: the queue jobId equals the delivery ID.
      const { jobs, queue } = createQueue();
      await dispatchDueNotificationDeliveries({
        now: NOW,
        queue,
        repository: deliveryRepository,
      });
      await dispatchDueNotificationDeliveries({
        now: NOW,
        queue,
        repository: deliveryRepository,
      });
      assert.equal(jobs.size, 1);

      // Process the delivery twice (BullMQ redelivery): one send, one no-op.
      const transport = new RecordingTransport();
      const [deliveryId] = [...jobs.keys()];
      assert.ok(deliveryId !== undefined);
      const deliveryJob = {
        data: { deliveryId },
        id: deliveryId,
        name: notificationDeliveryQueueContract.jobName,
      };
      const outcomes = [
        await processNotificationDeliveryJob(deliveryJob, {
          clock: () => NOW,
          preparer,
          repository: deliveryRepository,
          transport,
        }),
        await processNotificationDeliveryJob(deliveryJob, {
          clock: () => NOW,
          preparer,
          repository: deliveryRepository,
          transport,
        }),
      ];
      assert.deepEqual(outcomes, ["SENT", "NOT_CLAIMED"]);
      assert.equal(transport.sentPayloads.length, 1);
      assert.match(transport.sentPayloads[0]?.body ?? "", /from March 1, 2027 to March 5, 2027/u);

      const row = store.rows.get(deliveryId);
      assert.ok(row);
      assert.equal(row.status, "SENT");
      assert.deepEqual(row.sentAt, NOW);

      // Even after the send, replanning the same revision cannot re-notify:
      // the SENT row still owns the dedupe key.
      const afterSend = await planDateChangeNotifications(REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.ok(afterSend.status === "PLANNED");
      assert.equal(afterSend.createdCount, 0);
      assert.equal(store.ofType("DATE_CHANGED").length, 1);
    });

    it("supersedes an undelivered notification instead of sending both revisions", async () => {
      const { dateChangeRepository, store, world } = createHarness();
      applyVerifiedChange(world);
      const firstPlan = await planDateChangeNotifications(REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.ok(firstPlan.status === "PLANNED");

      // A second verified change lands before the first notification is sent.
      world.revisions.set(
        NEWER_REVISION_ID,
        approvedRevisionRow({
          newValue: "2027-03-08",
          oldValue: "2027-03-05",
          reviewedAt: new Date(REVIEWED_AT.getTime() + 60 * 60 * 1_000),
          revisionId: NEWER_REVISION_ID,
        }),
      );
      world.window.opensAt = new Date("2027-03-08T00:00:00.000Z");

      const secondPlan = await planDateChangeNotifications(NEWER_REVISION_ID, {
        now: NOW,
        repository: dateChangeRepository,
      });
      assert.ok(secondPlan.status === "PLANNED");
      assert.equal(secondPlan.cancelledStaleCount, 1);
      assert.equal(secondPlan.createdCount, 1);

      // Exactly one date-change notification remains deliverable for the user.
      const dateChangeRows = store.ofType("DATE_CHANGED");
      assert.equal(dateChangeRows.filter((row) => row.status === "SCHEDULED").length, 1);
      assert.equal(
        store.byDedupeKey(`athenvia:date-change:v1:${WATCHLIST_ID}:${REVISION_ID}`)?.status,
        "CANCELLED",
      );
      assert.equal(
        store.byDedupeKey(`athenvia:date-change:v1:${WATCHLIST_ID}:${NEWER_REVISION_ID}`)?.status,
        "SCHEDULED",
      );
    });
  });
});
