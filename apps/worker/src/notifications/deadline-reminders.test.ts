import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotificationPayloadSchema } from "@athenvia/contracts";
import type { database } from "@athenvia/database";

import {
  DeadlineReminderPreparationError,
  parseDeadlineReminderDedupeKey,
  prepareDeadlineReminderJob,
  prepareDeadlineReminderJobByDeliveryId,
  prepareDueDeadlineReminderJobs,
  PrismaDeadlineReminderJobRepository,
  type DeadlineReminderJobRepository,
  type DeadlineReminderOffset,
  type DueDeadlineReminderRecord,
} from "./deadline-reminders";
import { UTC_STORED_INSTANT_TIME_POLICY } from "./time-policy";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WATCHLIST_ID = "22222222-2222-4222-8222-222222222222";
const WINDOW_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_ID = "55555555-5555-4555-8555-555555555555";
const CLOSES_AT = new Date("2027-06-30T17:00:00.000Z");

function reminderRecord(
  offsetDays: DeadlineReminderOffset,
  overrides: Partial<DueDeadlineReminderRecord> = {},
): DueDeadlineReminderRecord {
  return {
    applicationWindows: [
      {
        closesAt: CLOSES_AT,
        id: WINDOW_ID,
        publicStatus: "CONFIRMED",
      },
    ],
    catalogueEligible: true,
    deadlinePreference: {
      beforeDeadlineDays: [30, 14, 7, 2],
    },
    dedupeKey: `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:${offsetDays}`,
    deliveryId: DELIVERY_ID,
    hasActivePushSubscription: true,
    intakeProgramId: PROGRAM_ID,
    notificationType: "APPLICATION_DEADLINE",
    officialSourceCandidates: ["https://admissions.example.edu/program?campaign=internal#apply"],
    programId: PROGRAM_ID,
    programName: "MSc Artificial Intelligence",
    scheduledFor: UTC_STORED_INSTANT_TIME_POLICY.reminderAt(CLOSES_AT, offsetDays),
    status: "SCHEDULED",
    trackingStatus: "WATCHING",
    universityName: "Example University",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
    watchlistOwnerUserId: USER_ID,
    ...overrides,
  };
}

function dueNow(record: DueDeadlineReminderRecord): Date {
  return new Date(record.scheduledFor.getTime() + 60 * 60 * 1_000);
}

function rejectionCode(record: DueDeadlineReminderRecord, now = dueNow(record)): string {
  try {
    prepareDeadlineReminderJob(record, now);
    return "NONE";
  } catch (error) {
    assert.ok(error instanceof DeadlineReminderPreparationError);
    return error.code;
  }
}

class FakeDeadlineRepository implements DeadlineReminderJobRepository {
  findCalls = 0;

  constructor(
    private readonly records: DueDeadlineReminderRecord[],
    private readonly found: DueDeadlineReminderRecord | null = records[0] ?? null,
  ) {}

  async findDeadlineReminderRecord(): Promise<DueDeadlineReminderRecord | null> {
    this.findCalls += 1;
    return this.found;
  }

  async listDueDeadlineReminderRecords(): Promise<DueDeadlineReminderRecord[]> {
    return this.records;
  }
}

describe("deadline reminder payloads", () => {
  it("prepares the exact 30-day, 14-day, 7-day, and 2-day confirmed reminders", () => {
    const cases: Array<[DeadlineReminderOffset, string]> = [
      [30, "Application deadline in 30 days"],
      [14, "Application deadline in 14 days"],
      [7, "Application deadline in 7 days"],
      [2, "Application deadline in 2 days"],
    ];

    for (const [offset, titlePrefix] of cases) {
      const record = reminderRecord(offset);
      const job = prepareDeadlineReminderJob(record, dueNow(record));

      assert.match(job.payload.title, new RegExp(`^${titlePrefix}`, "u"));
      assert.match(job.payload.title, /MSc Artificial Intelligence at Example University/u);
      assert.match(job.payload.body, /confirmed application deadline/u);
      assert.match(job.payload.body, /Official program source: admissions\.example\.edu/u);
      assert.equal(job.payload.dateStatus, "CONFIRMED");
      assert.equal(job.payload.type, "APPLICATION_DEADLINE");
      assert.equal(job.payload.programId, PROGRAM_ID);
      assert.equal(job.payload.watchlistId, WATCHLIST_ID);
      assert.equal(job.payload.deepLink, `/programs/${PROGRAM_ID}`);
      assert.equal(job.payload.dedupeKey, record.dedupeKey);
      assert.equal(job.payload.scheduledFor, record.scheduledFor.toISOString());
      assert.equal(job.jobId, DELIVERY_ID);
      assert.equal(job.deliveryId, DELIVERY_ID);
      assert.equal(job.userId, USER_ID);
      assert.deepEqual(NotificationPayloadSchema.parse(job.payload), job.payload);
    }
  });

  it("keeps every expected deadline explicitly expected and not confirmed", () => {
    for (const offset of [30, 14, 7, 2] as const) {
      const record = reminderRecord(offset, {
        applicationWindows: [
          {
            closesAt: CLOSES_AT,
            id: WINDOW_ID,
            publicStatus: "EXPECTED",
          },
        ],
      });
      const job = prepareDeadlineReminderJob(record, dueNow(record));

      assert.match(job.payload.title, /^Expected application deadline/u);
      assert.match(job.payload.body, /expected application deadline/u);
      assert.match(job.payload.body, /expected, not confirmed/u);
      assert.match(job.payload.body, /Program source: admissions\.example\.edu/u);
      assert.doesNotMatch(job.payload.body, /Official program source:/u);
      assert.equal(job.payload.dateStatus, "EXPECTED");
      assert.deepEqual(NotificationPayloadSchema.parse(job.payload), job.payload);
    }
  });

  it("identifies a safe program source without exposing its path, query, or fragment", () => {
    const record = reminderRecord(14, {
      officialSourceCandidates: [
        "javascript:alert(1)",
        "http://admissions.example.edu/insecure",
        "https://user:secret@admissions.example.edu/private",
        "https://admissions.example.edu:8443/private",
        "https://apply.example.edu/masters/ai?token=secret#section",
      ],
    });
    const job = prepareDeadlineReminderJob(record, dueNow(record));

    assert.equal(job.officialSourceUrl, "https://apply.example.edu/");
    assert.match(job.payload.body, /apply\.example\.edu/u);
    assert.doesNotMatch(JSON.stringify(job), /masters|token|secret|section/u);
  });

  it("sanitizes controls, bidi markers, and oversized Unicode labels", () => {
    const unsafeName = `MSc\u0000 Safe\u202e ${"🧑🏽‍🎓".repeat(100)}`;
    const record = reminderRecord(2, {
      applicationWindows: [
        {
          closesAt: CLOSES_AT,
          id: WINDOW_ID,
          publicStatus: "EXPECTED",
        },
      ],
      programName: unsafeName,
      universityName: `Example\u0007 University\u2066 ${"研究".repeat(100)}`,
    });
    const job = prepareDeadlineReminderJob(record, dueNow(record));

    assert.ok(job.payload.title.length <= 120);
    assert.ok(job.payload.body.length <= 240);
    assert.match(job.payload.body, /expected, not confirmed/u);
    assert.match(job.payload.body, /Program source: admissions\.example\.edu/u);
    assert.doesNotMatch(
      job.payload.title + job.payload.body,
      /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u,
    );
    assert.doesNotMatch(job.payload.title + job.payload.body, /\ud800(?![\udc00-\udfff])/u);
    assert.deepEqual(NotificationPayloadSchema.parse(job.payload), job.payload);
  });
});

describe("deadline reminder revalidation", () => {
  it("accepts a few hours late on the same UTC day and rejects stale prior-day jobs", () => {
    const record = reminderRecord(7);
    assert.equal(rejectionCode(record, dueNow(record)), "NONE");
    assert.equal(
      rejectionCode(record, new Date(record.scheduledFor.getTime() + 24 * 60 * 60 * 1_000)),
      "MISSED_DELIVERY_WINDOW",
    );
  });

  it("explicitly rejects a deadline that is at or before the current instant", () => {
    const now = new Date("2027-06-30T17:00:00.000Z");
    for (const closesAt of [
      new Date(now.getTime() - 1),
      new Date(now.getTime()),
      new Date(now.getTime() - 24 * 60 * 60 * 1_000),
    ]) {
      const record = reminderRecord(2, {
        applicationWindows: [{ closesAt, id: WINDOW_ID, publicStatus: "CONFIRMED" }],
        scheduledFor: new Date("2027-06-30T09:00:00.000Z"),
      });
      assert.equal(rejectionCode(record, now), "DEADLINE_PASSED");
    }
  });

  it("rejects deliveries outside the scheduled deadline lifecycle", () => {
    const record = reminderRecord(14);
    const cases: Array<[DueDeadlineReminderRecord, string]> = [
      [{ ...record, status: "SENT" }, "NOT_SCHEDULED"],
      [{ ...record, notificationType: "APPLICATION_OPENING" }, "WRONG_NOTIFICATION_TYPE"],
      [{ ...record, userId: "77777777-7777-4777-8777-777777777777" }, "INVALID_RECORD"],
      [{ ...record, intakeProgramId: "88888888-8888-4888-8888-888888888888" }, "INVALID_RECORD"],
      [{ ...record, hasActivePushSubscription: false }, "WATCHLIST_INELIGIBLE"],
      [{ ...record, catalogueEligible: false }, "WATCHLIST_INELIGIBLE"],
      [{ ...record, trackingStatus: "APPLIED" }, "WATCHLIST_INELIGIBLE"],
      [
        { ...record, deadlinePreference: { beforeDeadlineDays: [30, 7, 2] } },
        "PREFERENCE_DISABLED",
      ],
      [
        {
          ...record,
          dedupeKey: `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:0`,
        },
        "INVALID_DEDUPE_KEY",
      ],
      [
        {
          ...record,
          dedupeKey: `athenvia:reminder:v1:66666666-6666-4666-8666-666666666666:${WINDOW_ID}:deadline:14`,
        },
        "INVALID_DEDUPE_KEY",
      ],
      [{ ...record, applicationWindows: [] }, "WINDOW_NOT_FOUND"],
      [
        {
          ...record,
          applicationWindows: [
            { closesAt: CLOSES_AT, id: WINDOW_ID, publicStatus: "NOT_PUBLISHED" },
          ],
        },
        "DATE_NOT_DELIVERABLE",
      ],
      [
        {
          ...record,
          scheduledFor: new Date(record.scheduledFor.getTime() + 1),
        },
        "SCHEDULE_MISMATCH",
      ],
      [{ ...record, officialSourceCandidates: [] }, "OFFICIAL_SOURCE_MISSING"],
    ];

    for (const [candidate, expectedCode] of cases) {
      assert.equal(rejectionCode(candidate), expectedCode);
    }
  });

  it("rejects a future delivery before payload preparation", () => {
    const record = reminderRecord(30);
    assert.equal(rejectionCode(record, new Date(record.scheduledFor.getTime() - 1)), "NOT_DUE");
  });

  it("parses only canonical scheduler deadline keys and approved offsets", () => {
    for (const offsetDays of [30, 14, 7, 2] as const) {
      assert.deepEqual(parseDeadlineReminderDedupeKey(reminderRecord(offsetDays).dedupeKey), {
        offsetDays,
        watchlistId: WATCHLIST_ID,
        windowId: WINDOW_ID,
      });
    }
    for (const invalid of [
      "",
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:30`,
      `athenvia:reminder:v2:${WATCHLIST_ID}:${WINDOW_ID}:deadline:30`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:0`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:07`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:+7`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:7.0`,
      `athenvia:reminder:v1:unsafe:${WINDOW_ID}:deadline:7`,
    ]) {
      assert.equal(parseDeadlineReminderDedupeKey(invalid), null);
    }
  });
});

describe("deadline reminder preparation services", () => {
  it("prepares one delivery by ID without claiming or mutating lifecycle", async () => {
    const record = reminderRecord(7);
    const repository = new FakeDeadlineRepository([], record);
    const result = await prepareDeadlineReminderJobByDeliveryId(DELIVERY_ID, {
      now: dueNow(record),
      repository,
    });

    assert.equal(result.status, "READY");
    assert.equal(result.status === "READY" && result.job.deliveryId, DELIVERY_ID);
    assert.equal(repository.findCalls, 1);
    assert.equal(record.status, "SCHEDULED");
  });

  it("returns safe not-found, invalid-ID, and stale reasons", async () => {
    const repository = new FakeDeadlineRepository([], null);
    assert.deepEqual(await prepareDeadlineReminderJobByDeliveryId(DELIVERY_ID, { repository }), {
      deliveryId: DELIVERY_ID,
      status: "NOT_FOUND",
    });
    assert.deepEqual(await prepareDeadlineReminderJobByDeliveryId("not-a-uuid", { repository }), {
      code: "INVALID_RECORD",
      deliveryId: "not-a-uuid",
      status: "REJECTED",
    });
    assert.equal(repository.findCalls, 1);

    const stale = reminderRecord(7, { status: "CANCELLED" });
    assert.deepEqual(
      await prepareDeadlineReminderJobByDeliveryId(DELIVERY_ID, {
        now: dueNow(stale),
        repository: new FakeDeadlineRepository([], stale),
      }),
      {
        code: "NOT_SCHEDULED",
        deliveryId: DELIVERY_ID,
        status: "REJECTED",
      },
    );
  });

  it("prepares valid rows independently and reports stale rows without aborting the batch", async () => {
    const ready = reminderRecord(30);
    const stale = reminderRecord(30, {
      deliveryId: "66666666-6666-4666-8666-666666666666",
      officialSourceCandidates: [],
    });
    const result = await prepareDueDeadlineReminderJobs({
      now: dueNow(ready),
      repository: new FakeDeadlineRepository([ready, stale]),
    });

    assert.equal(result.jobs.length, 1);
    assert.deepEqual(result.rejected, [
      {
        code: "OFFICIAL_SOURCE_MISSING",
        deliveryId: stale.deliveryId,
      },
    ]);
  });

  it("validates batch bounds and the preparation clock", async () => {
    const repository = new FakeDeadlineRepository([]);
    await assert.rejects(prepareDueDeadlineReminderJobs({ limit: 0, repository }), RangeError);
    await assert.rejects(
      prepareDueDeadlineReminderJobs({
        now: new Date(Number.NaN),
        repository,
      }),
      TypeError,
    );
  });
});

describe("Prisma deadline reminder reads", () => {
  it("queries only current-day due scheduled deadlines and hydrates revalidation state", async () => {
    let receivedQuery: Record<string, unknown> | undefined;
    const fakeClient = {
      notificationDelivery: {
        findMany: async (query: Record<string, unknown>) => {
          receivedQuery = query;
          return [];
        },
      },
    };
    const repository = new PrismaDeadlineReminderJobRepository(
      fakeClient as unknown as typeof database,
    );
    const now = new Date("2027-01-01T15:30:00.000Z");

    assert.deepEqual(await repository.listDueDeadlineReminderRecords(now, 25), []);
    assert.deepEqual(receivedQuery?.where, {
      notificationType: "APPLICATION_DEADLINE",
      scheduledFor: {
        gte: new Date("2027-01-01T00:00:00.000Z"),
        lte: now,
      },
      status: "SCHEDULED",
    });
    assert.equal(receivedQuery?.take, 25);
    const select = receivedQuery?.select as {
      watchlist: {
        select: {
          intake: {
            select: {
              applicationWindows: { select: { closesAt: boolean } };
              programId: boolean;
            };
          };
          notificationPreference: unknown;
          program: { select: { sources: { where: unknown } } };
          trackingStatus: boolean;
          user: unknown;
          userId: boolean;
        };
      };
    };
    assert.equal(select.watchlist.select.intake.select.applicationWindows.select.closesAt, true);
    assert.equal(select.watchlist.select.intake.select.programId, true);
    assert.deepEqual(select.watchlist.select.program.select.sources.where, {
      isOfficial: true,
    });
    assert.ok(select.watchlist.select.notificationPreference);
    assert.equal(select.watchlist.select.trackingStatus, true);
    assert.equal(select.watchlist.select.userId, true);
    assert.ok(select.watchlist.select.user);
  });
});
