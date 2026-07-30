import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotificationPayloadSchema } from "@athenvia/contracts";

import {
  buildDateChangeDeliveryPlan,
  DateChangeNotificationError,
  parseDateChangeDedupeKey,
  planDateChangeNotifications,
  prepareDateChangeNotificationJob,
  prepareDateChangeNotificationJobByDeliveryId,
  prepareDueDateChangeNotificationJobs,
  PrismaDateChangeNotificationRepository,
  validateApprovedDateChange,
  type ApprovedDateChangeRevision,
  type DateChangeDeliveryRecord,
  type DateChangeNotificationRepository,
  type DateChangePlanningRepositoryResult,
  type DateChangeWatchlistCandidate,
} from "./date-change-notifications";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WATCHLIST_ID = "22222222-2222-4222-8222-222222222222";
const WINDOW_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const UNIVERSITY_ID = "55555555-5555-4555-8555-555555555555";
const REVISION_ID = "66666666-6666-4666-8666-666666666666";
const PREVIOUS_REVISION_ID = "66666666-6666-4666-8666-666666666667";
const SAME_DAY_REVISION_ID = "66666666-6666-4666-8666-666666666668";
const SOURCE_ID = "77777777-7777-4777-8777-777777777777";
const SNAPSHOT_ID = "88888888-8888-4888-8888-888888888888";
const DELIVERY_ID = "99999999-9999-4999-8999-999999999999";
const REVIEWED_AT = new Date("2027-01-10T10:00:00.000Z");
const NOW = new Date("2027-01-10T12:00:00.000Z");

function watchlistCandidate(
  overrides: Partial<DateChangeWatchlistCandidate> = {},
): DateChangeWatchlistCandidate {
  return {
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
    hasActivePushSubscription: true,
    intakeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    intakeProgramId: PROGRAM_ID,
    notifyOnDateChange: true,
    programId: PROGRAM_ID,
    programStatus: "ACTIVE",
    trackingStatus: "WATCHING",
    universityStatus: "ACTIVE",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
    ...overrides,
  };
}

function revision(overrides: Partial<ApprovedDateChangeRevision> = {}): ApprovedDateChangeRevision {
  return {
    canonicalValue: new Date("2027-03-05T00:00:00.000Z"),
    changeStatus: "APPROVED",
    conflictKey: `APPLICATION_WINDOW:${WINDOW_ID}:opensAt`,
    entityId: WINDOW_ID,
    entityType: "APPLICATION_WINDOW",
    fieldName: "opensAt",
    hasConflict: false,
    hasNewerApprovedRevision: false,
    hasUnresolvedConflict: false,
    intakeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    newValue: "2027-03-05",
    oldValue: "2027-03-01",
    programId: PROGRAM_ID,
    programName: "MSc Artificial Intelligence",
    publicStatus: "CONFIRMED",
    revisionId: REVISION_ID,
    reviewedAt: REVIEWED_AT,
    sourceId: SOURCE_ID,
    sourceIsOfficial: true,
    sourceProgramId: PROGRAM_ID,
    sourceSnapshotId: SNAPSHOT_ID,
    sourceSnapshotSourceId: SOURCE_ID,
    sourceUniversityId: UNIVERSITY_ID,
    sourceUrl: "https://admissions.example.edu/program?secret=token#apply",
    universityId: UNIVERSITY_ID,
    universityName: "Example University",
    watchlists: [watchlistCandidate()],
    ...overrides,
  };
}

function prismaRevisionRow(
  id = REVISION_ID,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    changeStatus: "APPROVED",
    conflictKey: `APPLICATION_WINDOW:${WINDOW_ID}:opensAt`,
    createdAt: new Date(
      id === PREVIOUS_REVISION_ID ? "2027-01-08T00:00:00Z" : "2027-01-09T00:00:00Z",
    ),
    entityId: WINDOW_ID,
    entityType: "APPLICATION_WINDOW",
    fieldName: "opensAt",
    hasConflict: false,
    id,
    newValue: id === PREVIOUS_REVISION_ID ? "2027-03-01" : "2027-03-05",
    oldValue: id === PREVIOUS_REVISION_ID ? "2027-02-25" : "2027-03-01",
    reviewedAt: id === PREVIOUS_REVISION_ID ? new Date("2027-01-09T10:00:00Z") : REVIEWED_AT,
    source: {
      id: SOURCE_ID,
      isOfficial: true,
      programId: PROGRAM_ID,
      universityId: UNIVERSITY_ID,
      url: "https://admissions.example.edu/program",
    },
    sourceId: SOURCE_ID,
    sourceSnapshot: { id: SNAPSHOT_ID, sourceId: SOURCE_ID },
    sourceSnapshotId: SNAPSHOT_ID,
    ...overrides,
  };
}

function prismaWindowRow(): Record<string, unknown> {
  return {
    closesAt: null,
    id: WINDOW_ID,
    intake: {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      program: {
        id: PROGRAM_ID,
        name: "MSc Artificial Intelligence",
        status: "ACTIVE",
        university: {
          id: UNIVERSITY_ID,
          name: "Example University",
          status: "ACTIVE",
        },
      },
      programId: PROGRAM_ID,
    },
    intakeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    opensAt: new Date("2027-03-05T00:00:00Z"),
    publicStatus: "CONFIRMED",
  };
}

function prismaWatchlistRow(): Record<string, unknown> {
  return {
    createdAt: new Date("2027-01-01T00:00:00Z"),
    id: WATCHLIST_ID,
    intake: { programId: PROGRAM_ID },
    intakeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    notificationPreference: null,
    program: {
      id: PROGRAM_ID,
      status: "ACTIVE",
      university: { status: "ACTIVE" },
    },
    programId: PROGRAM_ID,
    trackingStatus: "WATCHING",
    user: { pushSubscriptions: [{ id: "push-1" }] },
    userId: USER_ID,
  };
}

function prismaDeliveryRow(id: string, revisionId = REVISION_ID): Record<string, unknown> {
  return {
    dedupeKey: `athenvia:date-change:v1:${WATCHLIST_ID}:${revisionId}`,
    id,
    notificationType: "DATE_CHANGED",
    scheduledFor: new Date(NOW.getTime() - 60_000),
    status: "SCHEDULED",
    userId: USER_ID,
    watchlist: prismaWatchlistRow(),
    watchlistId: WATCHLIST_ID,
  };
}

function deliveryRecord(
  overrides: Partial<DateChangeDeliveryRecord> = {},
): DateChangeDeliveryRecord {
  return {
    dedupeKey: `athenvia:date-change:v1:${WATCHLIST_ID}:${REVISION_ID}`,
    deliveryId: DELIVERY_ID,
    notificationType: "DATE_CHANGED",
    revision: revision(),
    scheduledFor: new Date(NOW.getTime() - 60_000),
    status: "SCHEDULED",
    userId: USER_ID,
    watchlist: watchlistCandidate(),
    watchlistId: WATCHLIST_ID,
    ...overrides,
  };
}

function revisionCode(record: ApprovedDateChangeRevision, now = NOW): string {
  try {
    validateApprovedDateChange(record, now);
    return "NONE";
  } catch (error) {
    assert.ok(error instanceof DateChangeNotificationError);
    return error.code;
  }
}

function deliveryCode(record: DateChangeDeliveryRecord, now = NOW): string {
  try {
    prepareDateChangeNotificationJob(record, now);
    return "NONE";
  } catch (error) {
    assert.ok(error instanceof DateChangeNotificationError);
    return error.code;
  }
}

class FakeRepository implements DateChangeNotificationRepository {
  findCalls = 0;
  planCalls = 0;

  constructor(
    private readonly records: DateChangeDeliveryRecord[] = [],
    private readonly planned: DateChangePlanningRepositoryResult = {
      cancelledStaleCount: 0,
      createdCount: 1,
      eligibleCount: 1,
      revisionId: REVISION_ID,
      status: "PLANNED",
    },
  ) {}

  async findDateChangeDeliveryRecord(): Promise<DateChangeDeliveryRecord | null> {
    this.findCalls += 1;
    return this.records[0] ?? null;
  }

  async listDueDateChangeDeliveryRecords(): Promise<DateChangeDeliveryRecord[]> {
    return this.records;
  }

  async planApprovedDateChange(): Promise<DateChangePlanningRepositoryResult> {
    this.planCalls += 1;
    return this.planned;
  }
}

describe("date-change policy", () => {
  it("accepts date-only and timezone-qualified RFC3339 values by normalized UTC day", () => {
    const dateOnly = validateApprovedDateChange(revision(), NOW);
    assert.equal(dateOnly.kind, "MOVED");
    assert.equal(dateOnly.oldInstant?.toISOString(), "2027-03-01T00:00:00.000Z");
    assert.equal(dateOnly.newInstant?.toISOString(), "2027-03-05T00:00:00.000Z");

    const offset = validateApprovedDateChange(
      revision({
        canonicalValue: new Date("2027-03-05T18:00:00.000Z"),
        newValue: "2027-03-06T01:00:00+07:00",
        oldValue: "2027-03-01T23:30:00-05:00",
      }),
      NOW,
    );
    assert.equal(offset.kind, "MOVED");
    assert.equal(offset.newInstant?.toISOString(), "2027-03-05T18:00:00.000Z");
    assert.equal(offset.oldInstant?.toISOString(), "2027-03-02T04:30:00.000Z");
  });

  it("ignores same-day representation changes and null-to-null", () => {
    assert.equal(
      revisionCode(
        revision({
          newValue: "2027-03-05T23:59:00Z",
          oldValue: "2027-03-05",
        }),
      ),
      "NOT_MATERIAL",
    );
    assert.equal(
      revisionCode(revision({ canonicalValue: null, newValue: null, oldValue: null })),
      "NOT_MATERIAL",
    );
  });

  it("supports future date publication and removal", () => {
    const published = validateApprovedDateChange(revision({ oldValue: null }), NOW);
    assert.equal(published.kind, "PUBLISHED");
    assert.equal(published.oldInstant, null);

    const removed = validateApprovedDateChange(
      revision({
        canonicalValue: null,
        newValue: null,
        oldValue: "2027-03-01",
        publicStatus: "NOT_PUBLISHED",
      }),
      NOW,
    );
    assert.equal(removed.kind, "REMOVED");
    assert.equal(removed.newInstant, null);
  });

  it("anchors historical suppression to reviewedAt while retaining past/future crossings", () => {
    assert.equal(
      revisionCode(
        revision({
          canonicalValue: new Date("2027-01-02T00:00:00Z"),
          newValue: "2027-01-02",
          oldValue: "2027-01-01",
        }),
      ),
      "BOTH_DATES_PAST",
    );
    assert.equal(
      revisionCode(
        revision({
          canonicalValue: new Date("2027-01-02T00:00:00Z"),
          newValue: "2027-01-02",
          oldValue: null,
        }),
      ),
      "BOTH_DATES_PAST",
    );
    assert.equal(
      revisionCode(
        revision({
          canonicalValue: null,
          newValue: null,
          oldValue: "2027-01-02",
          publicStatus: "NOT_PUBLISHED",
        }),
      ),
      "BOTH_DATES_PAST",
    );
    assert.equal(
      validateApprovedDateChange(
        revision({
          canonicalValue: new Date("2027-01-02T00:00:00Z"),
          newValue: "2027-01-02",
          oldValue: "2027-03-01",
        }),
        NOW,
      ).kind,
      "MOVED",
    );
    assert.equal(
      validateApprovedDateChange(
        revision({
          newValue: "2027-03-05",
          oldValue: "2027-01-02",
        }),
        NOW,
      ).kind,
      "MOVED",
    );
  });

  it("rejects unsupported JSON values, invalid dates, and timestamps without timezone", () => {
    for (const newValue of [
      1_800_000_000,
      { date: "2027-03-05" },
      "2027-02-30",
      "2027-03-05T10:00:00",
    ]) {
      assert.equal(revisionCode(revision({ newValue })), "INVALID_RECORD");
    }
  });

  it("revalidates approval, conflict, audit clock, canonical state, and latest revision", () => {
    const cases: Array<[Partial<ApprovedDateChangeRevision>, string]> = [
      [{ changeStatus: "PENDING" }, "REVISION_NOT_APPROVED"],
      [{ reviewedAt: null }, "REVISION_NOT_APPROVED"],
      [{ reviewedAt: new Date("2027-01-11T00:00:00Z") }, "INVALID_RECORD"],
      [{ hasConflict: true }, "REVISION_CONFLICTED"],
      [{ hasUnresolvedConflict: true }, "REVISION_CONFLICTED"],
      [{ conflictKey: null }, "REVISION_CONFLICTED"],
      [{ conflictKey: `APPLICATION_WINDOW:${WINDOW_ID}:closesAt` }, "REVISION_CONFLICTED"],
      [{ hasNewerApprovedRevision: true }, "NEWER_REVISION_EXISTS"],
      [{ canonicalValue: new Date("2027-03-06T00:00:00Z") }, "CANONICAL_VALUE_STALE"],
      [{ publicStatus: "NOT_PUBLISHED" }, "CANONICAL_VALUE_STALE"],
      [{ entityType: "PROGRAM" }, "INVALID_RECORD"],
      [{ fieldName: "roundName" }, "INVALID_RECORD"],
    ];
    for (const [overrides, code] of cases) {
      assert.equal(revisionCode(revision(overrides)), code);
    }
  });

  it("requires coherent official snapshot evidence owned by the programme or its university", () => {
    const cases: Array<[Partial<ApprovedDateChangeRevision>, string]> = [
      [{ sourceIsOfficial: false }, "SOURCE_EVIDENCE_INVALID"],
      [{ sourceSnapshotId: null }, "SOURCE_EVIDENCE_INVALID"],
      [{ sourceSnapshotSourceId: SNAPSHOT_ID }, "SOURCE_EVIDENCE_INVALID"],
      [{ sourceUrl: "http://example.edu/path" }, "SOURCE_EVIDENCE_INVALID"],
      [{ sourceUrl: "https://user:secret@example.edu/path" }, "SOURCE_EVIDENCE_INVALID"],
      [{ sourceProgramId: WINDOW_ID }, "SOURCE_EVIDENCE_INVALID"],
      [
        { sourceProgramId: WINDOW_ID, sourceUniversityId: UNIVERSITY_ID },
        "SOURCE_EVIDENCE_INVALID",
      ],
      [{ sourceProgramId: null, sourceUniversityId: WINDOW_ID }, "SOURCE_EVIDENCE_INVALID"],
    ];
    for (const [overrides, code] of cases) {
      assert.equal(revisionCode(revision(overrides)), code);
    }
    assert.equal(
      revisionCode(revision({ sourceProgramId: null, sourceUniversityId: UNIVERSITY_ID })),
      "NONE",
    );
  });
});

describe("date-change planner", () => {
  it("creates a stable delivery only for coherent eligible pre-existing watchlists", () => {
    const good = watchlistCandidate();
    const candidates = [
      good,
      watchlistCandidate({
        watchlistId: "10000000-0000-4000-8000-000000000001",
        notifyOnDateChange: false,
      }),
      watchlistCandidate({
        watchlistId: "10000000-0000-4000-8000-000000000002",
        hasActivePushSubscription: false,
      }),
      watchlistCandidate({
        watchlistId: "10000000-0000-4000-8000-000000000003",
        trackingStatus: "APPLIED",
      }),
      watchlistCandidate({
        watchlistId: "10000000-0000-4000-8000-000000000004",
        programStatus: "PENDING",
      }),
      watchlistCandidate({
        watchlistId: "10000000-0000-4000-8000-000000000005",
        universityStatus: "PENDING",
      }),
      watchlistCandidate({
        watchlistId: "10000000-0000-4000-8000-000000000006",
        intakeId: WINDOW_ID,
      }),
      watchlistCandidate({
        watchlistId: "10000000-0000-4000-8000-000000000007",
        programId: WINDOW_ID,
      }),
      watchlistCandidate({
        createdAt: new Date("2027-01-10T11:00:00Z"),
        watchlistId: "10000000-0000-4000-8000-000000000008",
      }),
    ];
    const plan = buildDateChangeDeliveryPlan(revision({ watchlists: candidates }), NOW);
    assert.deepEqual(plan, [
      {
        dedupeKey: `athenvia:date-change:v1:${WATCHLIST_ID}:${REVISION_ID}`,
        notificationType: "DATE_CHANGED",
        scheduledFor: NOW,
        status: "SCHEDULED",
        userId: USER_ID,
        watchlistId: WATCHLIST_ID,
      },
    ]);
    assert.deepEqual(buildDateChangeDeliveryPlan(revision({ watchlists: [good] }), NOW), plan);
  });

  it("uses the strict watchlist-plus-revision dedupe contract", () => {
    assert.deepEqual(
      parseDateChangeDedupeKey(`athenvia:date-change:v1:${WATCHLIST_ID}:${REVISION_ID}`),
      { revisionId: REVISION_ID, watchlistId: WATCHLIST_ID },
    );
    for (const key of [
      `athenvia:date-change:v2:${WATCHLIST_ID}:${REVISION_ID}`,
      `athenvia:date-change:v1:${WATCHLIST_ID}:${REVISION_ID}:extra`,
      `athenvia:date-change:v1:not-a-uuid:${REVISION_ID}`,
      `athenvia:date-changed:v1:${WATCHLIST_ID}:${REVISION_ID}`,
    ]) {
      assert.equal(parseDateChangeDedupeKey(key), null);
    }
  });

  it("validates revision identifiers before delegating and preserves repository idempotency result", async () => {
    const repository = new FakeRepository();
    assert.deepEqual(await planDateChangeNotifications(REVISION_ID, { now: NOW, repository }), {
      cancelledStaleCount: 0,
      createdCount: 1,
      eligibleCount: 1,
      revisionId: REVISION_ID,
      status: "PLANNED",
    });
    assert.equal(repository.planCalls, 1);
    assert.deepEqual(await planDateChangeNotifications("invalid", { now: NOW, repository }), {
      cancelledStaleCount: 0,
      code: "INVALID_RECORD",
      revisionId: "invalid",
      status: "REJECTED",
    });
    assert.equal(repository.planCalls, 1);
  });
});

describe("date-change preparation", () => {
  it("prepares confirmed moved-date copy with explicit old/new values and origin-only evidence", () => {
    const job = prepareDateChangeNotificationJob(deliveryRecord(), NOW);
    assert.equal(NotificationPayloadSchema.safeParse(job.payload).success, true);
    assert.match(job.payload.title, /application opening date changed/iu);
    assert.match(job.payload.body, /from March 1, 2027 to March 5, 2027/iu);
    assert.match(job.payload.body, /Official source: admissions\.example\.edu/iu);
    assert.doesNotMatch(JSON.stringify(job), /secret|#apply|\/program\?/iu);
    assert.equal(job.officialSourceUrl, "https://admissions.example.edu/");
    assert.equal(job.payload.deepLink, `/programs/${PROGRAM_ID}`);
    assert.equal(job.payload.type, "DATE_CHANGED");
    assert.deepEqual(job.change, {
      fieldName: "opensAt",
      kind: "MOVED",
      newDate: "2027-03-05T00:00:00.000Z",
      oldDate: "2027-03-01T00:00:00.000Z",
    });
    assert.equal(job.jobId, DELIVERY_ID);
  });

  it("makes expected copy explicit and supports published and removed dates", () => {
    const expected = prepareDateChangeNotificationJob(
      deliveryRecord({
        revision: revision({ publicStatus: "EXPECTED" }),
      }),
      NOW,
    );
    assert.match(expected.payload.title, /^Expected application opening date changed/iu);
    assert.match(expected.payload.body, /expected, not confirmed/iu);

    const published = prepareDateChangeNotificationJob(
      deliveryRecord({ revision: revision({ oldValue: null }) }),
      NOW,
    );
    assert.equal(published.change.kind, "PUBLISHED");
    assert.match(published.payload.body, /published an application opening date/iu);

    const removedRevision = revision({
      canonicalValue: null,
      conflictKey: `APPLICATION_WINDOW:${WINDOW_ID}:closesAt`,
      fieldName: "closesAt",
      newValue: null,
      oldValue: "2027-03-01",
      publicStatus: "NOT_PUBLISHED",
    });
    const removed = prepareDateChangeNotificationJob(
      deliveryRecord({ revision: removedRevision }),
      NOW,
    );
    assert.equal(removed.change.kind, "REMOVED");
    assert.match(removed.payload.body, /No new date is published/iu);
  });

  it("revalidates delivery lifecycle, ownership, preferences, eligibility, due day, and revision", () => {
    const cases: Array<[DateChangeDeliveryRecord, string]> = [
      [deliveryRecord({ status: "PROCESSING" }), "NOT_SCHEDULED"],
      [deliveryRecord({ notificationType: "APPLICATION_OPENING" }), "WRONG_NOTIFICATION_TYPE"],
      [deliveryRecord({ scheduledFor: new Date(NOW.getTime() + 1) }), "NOT_DUE"],
      [
        deliveryRecord({ scheduledFor: new Date("2027-01-09T23:59:59Z") }),
        "MISSED_DELIVERY_WINDOW",
      ],
      [deliveryRecord({ dedupeKey: "invalid" }), "INVALID_DEDUPE_KEY"],
      [deliveryRecord({ userId: WINDOW_ID }), "INVALID_RECORD"],
      [
        deliveryRecord({
          watchlist: watchlistCandidate({ notifyOnDateChange: false }),
        }),
        "PREFERENCE_DISABLED",
      ],
      [
        deliveryRecord({
          watchlist: watchlistCandidate({ trackingStatus: "APPLIED" }),
        }),
        "WATCHLIST_INELIGIBLE",
      ],
      [
        deliveryRecord({
          revision: revision({ hasNewerApprovedRevision: true }),
        }),
        "NEWER_REVISION_EXISTS",
      ],
    ];
    for (const [record, code] of cases) {
      assert.equal(deliveryCode(record), code);
    }
  });

  it("prepares by ID and in bounded batches without mutating delivery records", async () => {
    const readyRecord = deliveryRecord();
    const staleRecord = deliveryRecord({
      deliveryId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      revision: revision({ hasNewerApprovedRevision: true }),
    });
    const repository = new FakeRepository([readyRecord, staleRecord]);
    const snapshot = structuredClone(readyRecord);
    const byId = await prepareDateChangeNotificationJobByDeliveryId(DELIVERY_ID, {
      now: NOW,
      repository,
    });
    assert.equal(byId.status, "READY");
    assert.deepEqual(readyRecord, snapshot);

    const batch = await prepareDueDateChangeNotificationJobs({
      limit: 2,
      now: NOW,
      repository,
    });
    assert.equal(batch.jobs.length, 1);
    assert.deepEqual(batch.rejected, [
      { code: "NEWER_REVISION_EXISTS", deliveryId: staleRecord.deliveryId },
    ]);
    await assert.rejects(
      prepareDueDateChangeNotificationJobs({ limit: 0, now: NOW, repository }),
      RangeError,
    );
  });

  it("rejects an invalid clock before repository I/O", async () => {
    const repository = new FakeRepository([deliveryRecord()]);
    assert.deepEqual(
      await prepareDateChangeNotificationJobByDeliveryId(DELIVERY_ID, {
        now: new Date("invalid"),
        repository,
      }),
      { code: "INVALID_RECORD", deliveryId: DELIVERY_ID, status: "REJECTED" },
    );
    assert.equal(repository.findCalls, 0);
  });
});

describe("date-change Prisma repository shape", () => {
  it("selects provenance invariants and bounds due reads to scheduled date changes today", async () => {
    let conflictQuery: Record<string, unknown> | undefined;
    let revisionQuery: Record<string, unknown> | undefined;
    const planningTransaction = {
      $executeRaw: async () => 0,
      applicationWindow: {
        findUnique: async () => null,
      },
      dataRevision: {
        count: async (query: Record<string, unknown>) => {
          conflictQuery = query;
          return 0;
        },
        findFirst: async () => ({ id: REVISION_ID }),
        findUnique: async (query: Record<string, unknown>) => {
          revisionQuery = query;
          return {
            changeStatus: "APPROVED",
            conflictKey: null,
            createdAt: new Date("2027-01-01T00:00:00Z"),
            entityId: WINDOW_ID,
            entityType: "APPLICATION_WINDOW",
            fieldName: "opensAt",
            hasConflict: false,
            id: REVISION_ID,
            newValue: "2027-03-05",
            oldValue: "2027-03-01",
            reviewedAt: REVIEWED_AT,
            source: null,
            sourceId: SOURCE_ID,
            sourceSnapshot: null,
            sourceSnapshotId: SNAPSHOT_ID,
          };
        },
      },
    };
    const planningClient = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation(planningTransaction),
    };
    const planningRepository = new PrismaDateChangeNotificationRepository(planningClient as never);
    assert.deepEqual(await planningRepository.planApprovedDateChange(REVISION_ID, NOW), {
      cancelledStaleCount: 0,
      code: "INVALID_RECORD",
      revisionId: REVISION_ID,
      status: "REJECTED",
    });
    const revisionSelect = revisionQuery?.select as {
      reviewedAt: boolean;
      source: { select: Record<string, boolean> };
      sourceSnapshot: { select: Record<string, boolean> };
    };
    assert.equal(revisionSelect.reviewedAt, true);
    assert.deepEqual(revisionSelect.source.select, {
      id: true,
      isOfficial: true,
      programId: true,
      universityId: true,
      url: true,
    });
    assert.deepEqual(revisionSelect.sourceSnapshot.select, {
      id: true,
      sourceId: true,
    });
    assert.deepEqual(conflictQuery?.where, {
      changeStatus: "PENDING",
      conflictKey: `APPLICATION_WINDOW:${WINDOW_ID}:opensAt`,
      id: { not: REVISION_ID },
    });

    let dueQuery: Record<string, unknown> | undefined;
    const dueTransaction = {
      notificationDelivery: {
        findMany: async (query: Record<string, unknown>) => {
          dueQuery = query;
          return [];
        },
      },
    };
    const dueClient = {
      $transaction: async (operation: (transaction: unknown) => unknown) =>
        operation(dueTransaction),
    };
    const dueRepository = new PrismaDateChangeNotificationRepository(dueClient as never);
    assert.deepEqual(await dueRepository.listDueDateChangeDeliveryRecords(NOW, 25), []);
    assert.deepEqual(dueQuery?.where, {
      notificationType: "DATE_CHANGED",
      scheduledFor: {
        gte: new Date("2027-01-10T00:00:00.000Z"),
        lte: NOW,
      },
      status: "SCHEDULED",
    });
    assert.equal(dueQuery?.take, 25);
    const dueSelect = dueQuery?.select as {
      watchlist: {
        select: {
          notificationPreference: { select: { notifyOnDateChange: boolean } };
          user: { select: { pushSubscriptions: { where: { revokedAt: null } } } };
        };
      };
    };
    assert.equal(dueSelect.watchlist.select.notificationPreference.select.notifyOnDateChange, true);
    assert.deepEqual(dueSelect.watchlist.select.user.select.pushSubscriptions.where, {
      revokedAt: null,
    });
  });

  it("locks the canonical field, cancels R1 before creating R2, and stays idempotent", async () => {
    const events: string[] = [];
    const locks: string[] = [];
    const storedDeliveries = [
      {
        dedupeKey: `athenvia:date-change:v1:${WATCHLIST_ID}:${PREVIOUS_REVISION_ID}`,
        id: "10000000-0000-4000-8000-000000000001",
        status: "SCHEDULED",
        watchlistId: WATCHLIST_ID,
      },
    ];
    const rows = new Map([
      [PREVIOUS_REVISION_ID, prismaRevisionRow(PREVIOUS_REVISION_ID)],
      [REVISION_ID, prismaRevisionRow()],
    ]);
    let latestRevisionId = REVISION_ID;
    const transaction = {
      $executeRaw: async (_query: TemplateStringsArray, lock: string) => {
        events.push("lock");
        locks.push(lock);
        return 0;
      },
      applicationWindow: {
        findUnique: async () => prismaWindowRow(),
      },
      dataRevision: {
        count: async () => 0,
        findFirst: async () => ({ id: latestRevisionId }),
        findMany: async (query: { where: { id: { in: string[] } } }) =>
          query.where.id.in
            .map((id) => rows.get(id))
            .filter((row) => row !== undefined)
            .map((row) => ({
              entityId: row?.entityId,
              entityType: row?.entityType,
              fieldName: row?.fieldName,
              id: row?.id,
            })),
        findUnique: async (query: { select: Record<string, unknown>; where: { id: string } }) => {
          const isIdentityRead = Object.keys(query.select).length === 3;
          events.push(isIdentityRead ? "pre-read" : "hydrate");
          const row = rows.get(query.where.id);
          if (row === undefined) {
            return null;
          }
          return isIdentityRead
            ? {
                entityId: row.entityId,
                entityType: row.entityType,
                fieldName: row.fieldName,
              }
            : row;
        },
      },
      notificationDelivery: {
        createMany: async (query: {
          data: Array<{ dedupeKey: string; watchlistId: string }>;
          skipDuplicates: boolean;
        }) => {
          events.push("create");
          assert.equal(query.skipDuplicates, true);
          let count = 0;
          for (const delivery of query.data) {
            if (!storedDeliveries.some(({ dedupeKey }) => dedupeKey === delivery.dedupeKey)) {
              storedDeliveries.push({
                dedupeKey: delivery.dedupeKey,
                id: "10000000-0000-4000-8000-000000000002",
                status: "SCHEDULED",
                watchlistId: delivery.watchlistId,
              });
              count += 1;
            }
          }
          return { count };
        },
        findMany: async (query: {
          where: {
            id?: { gt: string };
            status: string;
            watchlistId: { in: string[] };
          };
        }) =>
          storedDeliveries.filter(
            (delivery) =>
              delivery.status === query.where.status &&
              query.where.watchlistId.in.includes(delivery.watchlistId) &&
              (query.where.id === undefined || delivery.id > query.where.id.gt),
          ),
        updateMany: async (query: { where: { id: { in: string[] }; status: string } }) => {
          events.push("cancel");
          let count = 0;
          for (const delivery of storedDeliveries) {
            if (delivery.status === query.where.status && query.where.id.in.includes(delivery.id)) {
              delivery.status = "CANCELLED";
              count += 1;
            }
          }
          return { count };
        },
      },
      userWatchlist: {
        findMany: async () => [prismaWatchlistRow()],
      },
    };
    const client = {
      $transaction: async (operation: (value: unknown) => unknown) => operation(transaction),
    };
    const repository = new PrismaDateChangeNotificationRepository(client as never);

    assert.deepEqual(await repository.planApprovedDateChange(REVISION_ID, NOW), {
      cancelledStaleCount: 1,
      createdCount: 1,
      eligibleCount: 1,
      revisionId: REVISION_ID,
      status: "PLANNED",
    });
    assert.ok(events.indexOf("pre-read") < events.indexOf("lock"));
    assert.ok(events.indexOf("lock") < events.indexOf("hydrate"));
    assert.ok(events.indexOf("cancel") < events.indexOf("create"));
    assert.equal(storedDeliveries[0]?.status, "CANCELLED");

    assert.deepEqual(await repository.planApprovedDateChange(REVISION_ID, NOW), {
      cancelledStaleCount: 0,
      createdCount: 0,
      eligibleCount: 1,
      revisionId: REVISION_ID,
      status: "PLANNED",
    });
    assert.deepEqual(await repository.planApprovedDateChange(PREVIOUS_REVISION_ID, NOW), {
      cancelledStaleCount: 0,
      code: "NEWER_REVISION_EXISTS",
      revisionId: PREVIOUS_REVISION_ID,
      status: "REJECTED",
    });
    rows.set(
      SAME_DAY_REVISION_ID,
      prismaRevisionRow(SAME_DAY_REVISION_ID, {
        createdAt: new Date("2027-01-10T00:00:00Z"),
        id: SAME_DAY_REVISION_ID,
        newValue: "2027-03-05T18:00:00Z",
        oldValue: "2027-03-05",
      }),
    );
    latestRevisionId = SAME_DAY_REVISION_ID;
    assert.deepEqual(await repository.planApprovedDateChange(SAME_DAY_REVISION_ID, NOW), {
      cancelledStaleCount: 1,
      code: "NOT_MATERIAL",
      revisionId: SAME_DAY_REVISION_ID,
      status: "IGNORED",
    });
    assert.equal(storedDeliveries.filter(({ status }) => status === "SCHEDULED").length, 0);
    assert.deepEqual(
      locks,
      Array.from({ length: 4 }, () => `APPLICATION_WINDOW:${WINDOW_ID}:opensAt`),
    );
  });

  it("hydrates a shared revision once inside one due-read transaction", async () => {
    let fullRevisionReads = 0;
    let transactionCalls = 0;
    const transaction = {
      applicationWindow: {
        findUnique: async () => prismaWindowRow(),
      },
      dataRevision: {
        count: async () => 0,
        findFirst: async () => ({ id: REVISION_ID }),
        findUnique: async () => {
          fullRevisionReads += 1;
          return prismaRevisionRow();
        },
      },
      notificationDelivery: {
        findMany: async () => [
          prismaDeliveryRow("10000000-0000-4000-8000-000000000010"),
          prismaDeliveryRow("10000000-0000-4000-8000-000000000011"),
        ],
      },
    };
    const client = {
      $transaction: async (operation: (value: unknown) => unknown) => {
        transactionCalls += 1;
        return operation(transaction);
      },
    };
    const repository = new PrismaDateChangeNotificationRepository(client as never);
    const records = await repository.listDueDateChangeDeliveryRecords(NOW, 2);
    assert.equal(records.length, 2);
    assert.equal(records[0]?.revision?.revisionId, REVISION_ID);
    assert.equal(records[1]?.revision?.revisionId, REVISION_ID);
    assert.equal(fullRevisionReads, 1);
    assert.equal(transactionCalls, 1);
  });
});
