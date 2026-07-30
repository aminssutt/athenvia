import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NotificationPayloadSchema } from "@athenvia/contracts";
import type { database } from "@athenvia/database";

import {
  OpeningReminderPreparationError,
  parseOpeningReminderDedupeKey,
  prepareDueOpeningReminderJobs,
  prepareOpeningReminderJob,
  prepareOpeningReminderJobByDeliveryId,
  PrismaOpeningReminderJobRepository,
  type DueOpeningReminderRecord,
  type OpeningReminderJobRepository,
  type OpeningReminderOffset,
} from "./opening-reminders";
import { UTC_STORED_INSTANT_TIME_POLICY } from "./time-policy";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const WATCHLIST_ID = "22222222-2222-4222-8222-222222222222";
const WINDOW_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const DELIVERY_ID = "55555555-5555-4555-8555-555555555555";
const OPENS_AT = new Date("2027-06-01T09:00:00.000Z");

function reminderRecord(
  offsetDays: OpeningReminderOffset,
  overrides: Partial<DueOpeningReminderRecord> = {},
): DueOpeningReminderRecord {
  return {
    applicationWindows: [
      {
        id: WINDOW_ID,
        opensAt: OPENS_AT,
        publicStatus: "CONFIRMED",
      },
    ],
    catalogueEligible: true,
    dedupeKey: `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:${offsetDays}`,
    deliveryId: DELIVERY_ID,
    hasActivePushSubscription: true,
    intakeProgramId: PROGRAM_ID,
    notificationType: "APPLICATION_OPENING",
    officialSourceCandidates: ["https://admissions.example.edu/program?campaign=internal#apply"],
    openingPreference: {
      beforeOpenDays: [30, 7],
      notifyOnOpen: true,
    },
    programId: PROGRAM_ID,
    programName: "MSc Artificial Intelligence",
    scheduledFor: UTC_STORED_INSTANT_TIME_POLICY.reminderAt(OPENS_AT, offsetDays),
    status: "SCHEDULED",
    trackingStatus: "WATCHING",
    universityName: "Example University",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
    watchlistOwnerUserId: USER_ID,
    ...overrides,
  };
}

function dueNow(record: DueOpeningReminderRecord): Date {
  return new Date(record.scheduledFor.getTime() + 60 * 60 * 1_000);
}

function rejectionCode(record: DueOpeningReminderRecord, now = dueNow(record)): string {
  try {
    prepareOpeningReminderJob(record, now);
    return "NONE";
  } catch (error) {
    assert.ok(error instanceof OpeningReminderPreparationError);
    return error.code;
  }
}

class FakeOpeningRepository implements OpeningReminderJobRepository {
  findCalls = 0;

  constructor(
    private readonly records: DueOpeningReminderRecord[],
    private readonly found: DueOpeningReminderRecord | null = records[0] ?? null,
  ) {}

  async findOpeningReminderRecord(): Promise<DueOpeningReminderRecord | null> {
    this.findCalls += 1;
    return this.found;
  }

  async listDueOpeningReminderRecords(): Promise<DueOpeningReminderRecord[]> {
    return this.records;
  }
}

describe("opening reminder payloads", () => {
  it("prepares the 30-day, 7-day, and opening-day confirmed reminders", () => {
    const cases: Array<[OpeningReminderOffset, string]> = [
      [30, "Applications open in 30 days"],
      [7, "Applications open in 7 days"],
      [0, "Applications open today"],
    ];

    for (const [offset, titlePrefix] of cases) {
      const record = reminderRecord(offset);
      const job = prepareOpeningReminderJob(record, dueNow(record));

      assert.match(job.payload.title, new RegExp(`^${titlePrefix}`, "u"));
      assert.match(job.payload.title, /MSc Artificial Intelligence at Example University/u);
      assert.match(job.payload.body, /confirmed to open applications/u);
      assert.match(job.payload.body, /Official program source: admissions\.example\.edu/u);
      assert.equal(job.payload.dateStatus, "CONFIRMED");
      assert.equal(job.payload.type, "APPLICATION_OPENING");
      assert.equal(job.payload.programId, PROGRAM_ID);
      assert.equal(job.payload.watchlistId, WATCHLIST_ID);
      assert.equal(job.payload.deepLink, `/programs/${PROGRAM_ID}`);
      assert.equal(job.payload.dedupeKey, record.dedupeKey);
      assert.equal(job.jobId, DELIVERY_ID);
      assert.equal(job.deliveryId, DELIVERY_ID);
      assert.equal(job.userId, USER_ID);
      assert.deepEqual(NotificationPayloadSchema.parse(job.payload), job.payload);
    }
  });

  it("calls every expected date expected and never presents it as confirmed", () => {
    for (const offset of [30, 7, 0] as const) {
      const record = reminderRecord(offset, {
        applicationWindows: [
          {
            id: WINDOW_ID,
            opensAt: OPENS_AT,
            publicStatus: "EXPECTED",
          },
        ],
      });
      const job = prepareOpeningReminderJob(record, dueNow(record));

      assert.match(job.payload.title, /^Expected application opening/u);
      assert.match(job.payload.body, /is expected to open/u);
      assert.match(job.payload.body, /expected, not confirmed/u);
      assert.match(job.payload.body, /Program source: admissions\.example\.edu/u);
      assert.doesNotMatch(job.payload.body, /Official program source:/u);
      assert.equal(job.payload.dateStatus, "EXPECTED");
    }
  });

  it("uses HTTPS sources without exposing path, query, or fragment in the job", () => {
    const record = reminderRecord(7, {
      officialSourceCandidates: [
        "javascript:alert(1)",
        "http://admissions.example.edu/insecure",
        "https://user:secret@admissions.example.edu/private",
        "https://admissions.example.edu:8443/private",
        "https://apply.example.edu/masters/ai?token=secret#section",
      ],
    });
    const job = prepareOpeningReminderJob(record, dueNow(record));

    assert.equal(job.officialSourceUrl, "https://apply.example.edu/");
    assert.match(job.payload.body, /apply\.example\.edu/u);
    assert.doesNotMatch(JSON.stringify(job), /masters|token|secret|section/u);
  });

  it("sanitizes controls, bidi markers, and long Unicode labels without splitting code points", () => {
    const unsafeName = `MSc\u0000 Safe\u202e ${"🧑🏽‍🎓".repeat(100)}`;
    const record = reminderRecord(0, {
      applicationWindows: [
        {
          id: WINDOW_ID,
          opensAt: OPENS_AT,
          publicStatus: "EXPECTED",
        },
      ],
      programName: unsafeName,
      universityName: `Example\u0007 University\u2066 ${"研究".repeat(100)}`,
    });
    const job = prepareOpeningReminderJob(record, dueNow(record));

    assert.ok(job.payload.title.length <= 120);
    assert.ok(job.payload.body.length <= 240);
    assert.match(job.payload.body, /Program source: admissions\.example\.edu/u);
    assert.ok(
      Array.from(job.payload.title + job.payload.body).every((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f);
      }),
    );
    assert.doesNotMatch(
      job.payload.title + job.payload.body,
      /[\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/u,
    );
    assert.doesNotMatch(job.payload.title + job.payload.body, /\ud800(?![\udc00-\udfff])/u);
    assert.deepEqual(NotificationPayloadSchema.parse(job.payload), job.payload);
  });
});

describe("opening reminder revalidation", () => {
  it("accepts a few hours late on the same UTC day but rejects the next day", () => {
    const record = reminderRecord(7);
    assert.equal(rejectionCode(record, dueNow(record)), "NONE");
    assert.equal(
      rejectionCode(record, new Date(record.scheduledFor.getTime() + 24 * 60 * 60 * 1_000)),
      "MISSED_DELIVERY_WINDOW",
    );
  });

  it("rejects deliveries outside the scheduled opening lifecycle", () => {
    const record = reminderRecord(7);
    const cases: Array<[DueOpeningReminderRecord, string]> = [
      [{ ...record, status: "SENT" }, "NOT_SCHEDULED"],
      [{ ...record, notificationType: "APPLICATION_DEADLINE" }, "WRONG_NOTIFICATION_TYPE"],
      [
        {
          ...record,
          userId: "77777777-7777-4777-8777-777777777777",
        },
        "INVALID_RECORD",
      ],
      [
        {
          ...record,
          intakeProgramId: "88888888-8888-4888-8888-888888888888",
        },
        "INVALID_RECORD",
      ],
      [{ ...record, hasActivePushSubscription: false }, "WATCHLIST_INELIGIBLE"],
      [{ ...record, catalogueEligible: false }, "WATCHLIST_INELIGIBLE"],
      [{ ...record, trackingStatus: "APPLIED" }, "WATCHLIST_INELIGIBLE"],
      [
        {
          ...record,
          openingPreference: { beforeOpenDays: [], notifyOnOpen: true },
        },
        "PREFERENCE_DISABLED",
      ],
      [
        {
          ...record,
          dedupeKey: `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:14`,
        },
        "INVALID_DEDUPE_KEY",
      ],
      [
        {
          ...record,
          dedupeKey: `athenvia:reminder:v1:66666666-6666-4666-8666-666666666666:${WINDOW_ID}:opening:7`,
        },
        "INVALID_DEDUPE_KEY",
      ],
      [{ ...record, applicationWindows: [] }, "WINDOW_NOT_FOUND"],
      [
        {
          ...record,
          applicationWindows: [{ id: WINDOW_ID, opensAt: OPENS_AT, publicStatus: "NOT_PUBLISHED" }],
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

  it("rejects a future delivery before other payload preparation", () => {
    const record = reminderRecord(30);
    assert.equal(rejectionCode(record, new Date(record.scheduledFor.getTime() - 1)), "NOT_DUE");
  });

  it("requires notifyOnOpen specifically for day zero", () => {
    const record = reminderRecord(0, {
      openingPreference: { beforeOpenDays: [30, 7, 0], notifyOnOpen: false },
    });
    assert.equal(rejectionCode(record), "PREFERENCE_DISABLED");
  });

  it("parses only stable scheduler opening keys and approved offsets", () => {
    assert.deepEqual(parseOpeningReminderDedupeKey(reminderRecord(30).dedupeKey), {
      offsetDays: 30,
      watchlistId: WATCHLIST_ID,
      windowId: WINDOW_ID,
    });
    for (const invalid of [
      "",
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:30`,
      `athenvia:reminder:v2:${WATCHLIST_ID}:${WINDOW_ID}:opening:30`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:14`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:07`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:+7`,
      `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:7.0`,
      `athenvia:reminder:v1:unsafe:${WINDOW_ID}:opening:7`,
    ]) {
      assert.equal(parseOpeningReminderDedupeKey(invalid), null);
    }
  });
});

describe("opening reminder preparation services", () => {
  it("prepares one delivery by ID without claiming or mutating lifecycle", async () => {
    const record = reminderRecord(7);
    const repository = new FakeOpeningRepository([], record);
    const result = await prepareOpeningReminderJobByDeliveryId(DELIVERY_ID, {
      now: dueNow(record),
      repository,
    });

    assert.equal(result.status, "READY");
    assert.equal(result.status === "READY" && result.job.deliveryId, DELIVERY_ID);
    assert.equal(repository.findCalls, 1);
    assert.equal(record.status, "SCHEDULED");
  });

  it("returns safe not-found and stale reasons for delivery-ID preparation", async () => {
    const missingRepository = new FakeOpeningRepository([], null);
    assert.deepEqual(
      await prepareOpeningReminderJobByDeliveryId(DELIVERY_ID, {
        repository: missingRepository,
      }),
      { deliveryId: DELIVERY_ID, status: "NOT_FOUND" },
    );

    const stale = reminderRecord(7, { status: "CANCELLED" });
    assert.deepEqual(
      await prepareOpeningReminderJobByDeliveryId(DELIVERY_ID, {
        now: dueNow(stale),
        repository: new FakeOpeningRepository([], stale),
      }),
      {
        code: "NOT_SCHEDULED",
        deliveryId: DELIVERY_ID,
        status: "REJECTED",
      },
    );
  });

  it("never prepares a job for a delivery owned by another user", async () => {
    const mismatchedOwner = reminderRecord(7, {
      userId: "77777777-7777-4777-8777-777777777777",
    });
    const result = await prepareOpeningReminderJobByDeliveryId(DELIVERY_ID, {
      now: dueNow(mismatchedOwner),
      repository: new FakeOpeningRepository([], mismatchedOwner),
    });

    assert.deepEqual(result, {
      code: "INVALID_RECORD",
      deliveryId: DELIVERY_ID,
      status: "REJECTED",
    });
    assert.ok(!("job" in result));
  });

  it("never prepares a job when the watchlist intake belongs to another program", async () => {
    const mismatchedTarget = reminderRecord(7, {
      intakeProgramId: "88888888-8888-4888-8888-888888888888",
    });
    const result = await prepareOpeningReminderJobByDeliveryId(DELIVERY_ID, {
      now: dueNow(mismatchedTarget),
      repository: new FakeOpeningRepository([], mismatchedTarget),
    });

    assert.deepEqual(result, {
      code: "INVALID_RECORD",
      deliveryId: DELIVERY_ID,
      status: "REJECTED",
    });
    assert.ok(!("job" in result));
  });

  it("rejects an invalid delivery ID before querying persistence", async () => {
    const repository = new FakeOpeningRepository([]);
    assert.deepEqual(
      await prepareOpeningReminderJobByDeliveryId("not-a-uuid", {
        repository,
      }),
      {
        code: "INVALID_RECORD",
        deliveryId: "not-a-uuid",
        status: "REJECTED",
      },
    );
    assert.equal(repository.findCalls, 0);
  });

  it("prepares due records independently and reports stale rows without aborting the batch", async () => {
    const ready = reminderRecord(30);
    const stale = reminderRecord(30, {
      deliveryId: "66666666-6666-4666-8666-666666666666",
      officialSourceCandidates: [],
    });
    const result = await prepareDueOpeningReminderJobs({
      now: dueNow(ready),
      repository: new FakeOpeningRepository([ready, stale]),
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
    const repository = new FakeOpeningRepository([]);
    await assert.rejects(prepareDueOpeningReminderJobs({ limit: 0, repository }), RangeError);
    await assert.rejects(
      prepareDueOpeningReminderJobs({
        now: new Date(Number.NaN),
        repository,
      }),
      TypeError,
    );
  });
});

describe("Prisma opening reminder reads", () => {
  it("queries only due scheduled opening deliveries and hydrates revalidation state", async () => {
    let receivedQuery: Record<string, unknown> | undefined;
    const fakeClient = {
      notificationDelivery: {
        findMany: async (query: Record<string, unknown>) => {
          receivedQuery = query;
          return [];
        },
      },
    };
    const repository = new PrismaOpeningReminderJobRepository(
      fakeClient as unknown as typeof database,
    );
    const now = new Date("2027-01-01T00:00:00.000Z");

    assert.deepEqual(await repository.listDueOpeningReminderRecords(now, 25), []);
    assert.deepEqual(receivedQuery?.where, {
      notificationType: "APPLICATION_OPENING",
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
          intake: { select: { programId: boolean } };
          notificationPreference: unknown;
          program: { select: { sources: { where: unknown } } };
          trackingStatus: boolean;
          user: unknown;
          userId: boolean;
        };
      };
    };
    assert.deepEqual(select.watchlist.select.program.select.sources.where, {
      isOfficial: true,
    });
    assert.ok(select.watchlist.select.notificationPreference);
    assert.equal(select.watchlist.select.intake.select.programId, true);
    assert.equal(select.watchlist.select.trackingStatus, true);
    assert.equal(select.watchlist.select.userId, true);
    assert.ok(select.watchlist.select.user);
  });
});
