import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createDeliveryClaimMarkers,
  dispatchDueNotificationDeliveries,
  parseDeliveryClaimMarker,
  PrismaClaimedNotificationPreparer,
  PrismaNotificationDeliveryRepository,
  processNotificationDeliveryJob,
  recoverStaleNotificationDeliveries,
  STALE_NOTIFICATION_CLAIM_MILLISECONDS,
  StaleClaimedNotificationError,
  type ClaimedDeliveryIdentity,
  type ClaimedNotificationPreparer,
  type DeliveryLogger,
  type DeliveryQueue,
  type NotificationDeliveryRepository,
} from "./notification-delivery";
import type { DateChangeDeliveryRecord } from "./notifications/date-change-notifications";
import type { DueDeadlineReminderRecord } from "./notifications/deadline-reminders";
import type { DueOpeningReminderRecord } from "./notifications/opening-reminders";
import {
  NotificationDeliveryJobDataSchema,
  notificationDeliveryQueueContract,
} from "./queue-contracts";
import {
  createWebPushTopic,
  minimalWebPushPayload,
  WebPushNotificationTransport,
  WEB_PUSH_TIMEOUT_MILLISECONDS,
  WEB_PUSH_TTL_SECONDS,
  type ActivePushSubscription,
  type NotificationTransport,
  type WebPushSender,
} from "./web-push-transport";

import type { NotificationPayload } from "@athenvia/contracts";
import type { NotificationType } from "@athenvia/database";
import type { PushRetrySleeper } from "./notifications/push-retries";

const DELIVERY_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_DELIVERY_ID = "11111111-1111-4111-8111-111111111112";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const WATCHLIST_ID = "33333333-3333-4333-8333-333333333333";
const PROGRAM_ID = "44444444-4444-4444-8444-444444444444";
const CLAIM_TOKEN = "55555555-5555-4555-8555-555555555555";
const WINDOW_ID = "66666666-6666-4666-8666-666666666666";
const REVISION_ID = "77777777-7777-4777-8777-777777777777";
const SOURCE_ID = "88888888-8888-4888-8888-888888888888";
const UNIVERSITY_ID = "99999999-9999-4999-8999-999999999999";
const NOW = new Date("2027-01-10T12:00:00.000Z");
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;

function payload(type: NotificationType = "APPLICATION_OPENING"): NotificationPayload {
  return {
    body: "A safe reminder body.",
    dateStatus: "CONFIRMED",
    dedupeKey: `athenvia:test:${DELIVERY_ID}`,
    deepLink: `/programs/${PROGRAM_ID}`,
    programId: PROGRAM_ID,
    scheduledFor: NOW.toISOString(),
    title: "A safe reminder",
    type,
    watchlistId: WATCHLIST_ID,
  };
}

function subscription(id: string): ActivePushSubscription {
  return {
    auth: `auth-secret-${id}`,
    endpoint: `https://push.example.test/${id}?private=endpoint`,
    id,
    p256dh: `p256dh-secret-${id}`,
  };
}

function openingRecord(): DueOpeningReminderRecord {
  return {
    applicationWindows: [
      {
        id: WINDOW_ID,
        opensAt: new Date(NOW.getTime() + 30 * DAY_MILLISECONDS),
        publicStatus: "CONFIRMED",
      },
    ],
    catalogueEligible: true,
    dedupeKey: `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:opening:30`,
    deliveryId: DELIVERY_ID,
    hasActivePushSubscription: true,
    intakeProgramId: PROGRAM_ID,
    notificationType: "APPLICATION_OPENING",
    officialSourceCandidates: ["https://admissions.example.edu/program"],
    openingPreference: { beforeOpenDays: [30], notifyOnOpen: true },
    programId: PROGRAM_ID,
    programName: "MSc Artificial Intelligence",
    scheduledFor: NOW,
    status: "PROCESSING",
    trackingStatus: "WATCHING",
    universityName: "Example University",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
    watchlistOwnerUserId: USER_ID,
  };
}

function deadlineRecord(): DueDeadlineReminderRecord {
  return {
    applicationWindows: [
      {
        closesAt: new Date(NOW.getTime() + 14 * DAY_MILLISECONDS),
        id: WINDOW_ID,
        publicStatus: "CONFIRMED",
      },
    ],
    catalogueEligible: true,
    deadlinePreference: { beforeDeadlineDays: [14] },
    dedupeKey: `athenvia:reminder:v1:${WATCHLIST_ID}:${WINDOW_ID}:deadline:14`,
    deliveryId: DELIVERY_ID,
    hasActivePushSubscription: true,
    intakeProgramId: PROGRAM_ID,
    notificationType: "APPLICATION_DEADLINE",
    officialSourceCandidates: ["https://admissions.example.edu/program"],
    programId: PROGRAM_ID,
    programName: "MSc Artificial Intelligence",
    scheduledFor: NOW,
    status: "PROCESSING",
    trackingStatus: "WATCHING",
    universityName: "Example University",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
    watchlistOwnerUserId: USER_ID,
  };
}

function dateChangeRecord(): DateChangeDeliveryRecord {
  const watchlist = {
    createdAt: new Date("2027-01-01T00:00:00.000Z"),
    hasActivePushSubscription: true,
    intakeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    intakeProgramId: PROGRAM_ID,
    notifyOnDateChange: true,
    programId: PROGRAM_ID,
    programStatus: "ACTIVE",
    trackingStatus: "WATCHING" as const,
    universityStatus: "ACTIVE",
    userId: USER_ID,
    watchlistId: WATCHLIST_ID,
  };
  return {
    dedupeKey: `athenvia:date-change:v1:${WATCHLIST_ID}:${REVISION_ID}`,
    deliveryId: DELIVERY_ID,
    notificationType: "DATE_CHANGED",
    revision: {
      canonicalValue: new Date("2027-03-05T00:00:00.000Z"),
      changeStatus: "APPROVED",
      conflictKey: `APPLICATION_WINDOW:${WINDOW_ID}:opensAt`,
      entityId: WINDOW_ID,
      entityType: "APPLICATION_WINDOW",
      fieldName: "opensAt",
      hasConflict: false,
      hasNewerApprovedRevision: false,
      hasUnresolvedConflict: false,
      intakeId: watchlist.intakeId,
      newValue: "2027-03-05",
      oldValue: "2027-03-01",
      programId: PROGRAM_ID,
      programName: "MSc Artificial Intelligence",
      publicStatus: "CONFIRMED",
      revisionId: REVISION_ID,
      reviewedAt: new Date("2027-01-10T10:00:00.000Z"),
      sourceId: SOURCE_ID,
      sourceIsOfficial: true,
      sourceProgramId: PROGRAM_ID,
      sourceSnapshotId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab",
      sourceSnapshotSourceId: SOURCE_ID,
      sourceUniversityId: UNIVERSITY_ID,
      sourceUrl: "https://admissions.example.edu/program",
      universityId: UNIVERSITY_ID,
      universityName: "Example University",
      watchlists: [watchlist],
    },
    scheduledFor: NOW,
    status: "PROCESSING",
    userId: USER_ID,
    watchlist,
    watchlistId: WATCHLIST_ID,
  };
}

class FakeRepository implements NotificationDeliveryRepository {
  claimCalls = 0;
  finalizeCalls: Array<{
    marker: string | null;
    safeMessage: string | null;
    status: string;
  }> = [];
  marker: string | null = null;
  sentAt: Date | null = null;
  status: "CANCELLED" | "FAILED" | "PROCESSING" | "SCHEDULED" | "SENT" = "SCHEDULED";
  subscriptions: ActivePushSubscription[] = [subscription("one")];
  revokedSubscriptionIds: string[] = [];

  constructor(
    readonly identity: ClaimedDeliveryIdentity = {
      notificationType: "APPLICATION_OPENING",
      userId: USER_ID,
    },
  ) {}

  async listDueScheduledDeliveryIds(): Promise<string[]> {
    return this.status === "SCHEDULED" ? [DELIVERY_ID] : [];
  }

  async listProcessingDeliveryClaims() {
    return this.status === "PROCESSING" ? [{ deliveryId: DELIVERY_ID, marker: this.marker }] : [];
  }

  async claimScheduledDelivery(
    _deliveryId: string,
    _claimedAt: Date,
    marker: string,
  ): Promise<boolean> {
    this.claimCalls += 1;
    if (this.status !== "SCHEDULED") {
      return false;
    }
    this.status = "PROCESSING";
    this.marker = marker;
    return true;
  }

  async loadClaimedDeliveryIdentity(
    _deliveryId: string,
    marker: string,
  ): Promise<ClaimedDeliveryIdentity | null> {
    return this.status === "PROCESSING" && this.marker === marker ? this.identity : null;
  }

  async listActivePushSubscriptions(): Promise<ActivePushSubscription[]> {
    return this.subscriptions;
  }

  async promoteClaimToSending(
    _deliveryId: string,
    claimedMarker: string,
    sendingMarker: string,
  ): Promise<boolean> {
    if (this.status !== "PROCESSING" || this.marker !== claimedMarker) {
      return false;
    }
    this.marker = sendingMarker;
    return true;
  }

  async finalizeClaimedDelivery(
    _deliveryId: string,
    marker: string | null,
    status: "CANCELLED" | "FAILED" | "SENT",
    completedAt: Date,
    safeMessage: string | null,
  ): Promise<boolean> {
    this.finalizeCalls.push({ marker, safeMessage, status });
    if (this.status !== "PROCESSING" || this.marker !== marker) {
      return false;
    }
    this.status = status;
    this.marker = safeMessage;
    this.sentAt = status === "SENT" ? completedAt : null;
    return true;
  }

  async resetStaleClaimedDelivery(
    _deliveryId: string,
    claimedMarker: string,
    safeMessage: string,
  ): Promise<boolean> {
    if (this.status !== "PROCESSING" || this.marker !== claimedMarker) {
      return false;
    }
    this.status = "SCHEDULED";
    this.marker = safeMessage;
    this.sentAt = null;
    return true;
  }

  async revokeInvalidPushSubscriptions(
    _userId: string,
    subscriptionIds: string[],
  ): Promise<number> {
    this.revokedSubscriptionIds.push(...subscriptionIds);
    const revoked = new Set(subscriptionIds);
    this.subscriptions = this.subscriptions.filter(({ id }) => !revoked.has(id));
    return subscriptionIds.length;
  }
}

class FakePreparer implements ClaimedNotificationPreparer {
  constructor(
    private readonly action: (
      identity: ClaimedDeliveryIdentity,
    ) => NotificationPayload | Promise<NotificationPayload> = (identity) =>
      payload(identity.notificationType),
  ) {}

  async prepare(
    _deliveryId: string,
    identity: ClaimedDeliveryIdentity,
  ): Promise<{ payload: NotificationPayload; userId: string }> {
    return { payload: await this.action(identity), userId: identity.userId };
  }
}

class FakeTransport implements NotificationTransport {
  sent: string[] = [];

  constructor(private readonly failures = new Set<string>()) {}

  async send(
    pushSubscription: ActivePushSubscription,
    _payload: NotificationPayload,
  ): Promise<void> {
    this.sent.push(pushSubscription.id);
    if (this.failures.has(pushSubscription.id)) {
      throw new Error(`transport-secret-${pushSubscription.auth}`);
    }
  }
}

function job(data: unknown = { deliveryId: DELIVERY_ID }) {
  return {
    data,
    id: DELIVERY_ID,
    name: notificationDeliveryQueueContract.jobName,
  };
}

function processorOptions(
  repository: FakeRepository,
  overrides: {
    logger?: DeliveryLogger;
    preparer?: ClaimedNotificationPreparer;
    retrySleeper?: PushRetrySleeper;
    transport?: NotificationTransport;
  } = {},
) {
  return {
    clock: () => NOW,
    logger: overrides.logger,
    preparer: overrides.preparer ?? new FakePreparer(),
    repository,
    retrySleeper: overrides.retrySleeper,
    tokenFactory: () => CLAIM_TOKEN,
    transport: overrides.transport ?? new FakeTransport(),
  };
}

describe("notification delivery queue contract", () => {
  it("accepts only a strict deliveryId payload and uses a stable job name", () => {
    assert.deepEqual(NotificationDeliveryJobDataSchema.parse({ deliveryId: DELIVERY_ID }), {
      deliveryId: DELIVERY_ID,
    });
    assert.equal(notificationDeliveryQueueContract.jobName, "deliver-notification");
    assert.equal(notificationDeliveryQueueContract.queueName, "notifications");
    assert.throws(
      () =>
        NotificationDeliveryJobDataSchema.parse({
          deliveryId: DELIVERY_ID,
          endpoint: "https://secret.example",
        }),
      /unrecognized/iu,
    );
  });

  it("rejects tampered name, data, and BullMQ job ID before claiming", async () => {
    const repository = new FakeRepository();
    await assert.rejects(
      processNotificationDeliveryJob({ ...job(), name: "other-job" }, processorOptions(repository)),
      TypeError,
    );
    await assert.rejects(
      processNotificationDeliveryJob(
        job({ deliveryId: DELIVERY_ID, auth: "secret" }),
        processorOptions(repository),
      ),
    );
    await assert.rejects(
      processNotificationDeliveryJob(
        { ...job(), id: SECOND_DELIVERY_ID },
        processorOptions(repository),
      ),
      TypeError,
    );
    assert.equal(repository.claimCalls, 0);
  });

  it("dispatches due IDs with jobId dedupe and attempts fixed to one", async () => {
    const repository = new FakeRepository();
    const jobs = new Map<string, unknown>();
    const addCalls: Array<Record<string, unknown>> = [];
    const queue: DeliveryQueue = {
      add: async (name, data, options) => {
        addCalls.push({ data, name, options });
        if (!jobs.has(options.jobId)) {
          jobs.set(options.jobId, data);
        }
        return jobs.get(options.jobId);
      },
    };
    await dispatchDueNotificationDeliveries({ now: NOW, queue, repository });
    await dispatchDueNotificationDeliveries({ now: NOW, queue, repository });
    assert.equal(jobs.size, 1);
    assert.equal(addCalls.length, 2);
    assert.deepEqual(addCalls[0], {
      data: { deliveryId: DELIVERY_ID },
      name: "deliver-notification",
      options: { attempts: 1, jobId: DELIVERY_ID },
    });
  });
});

describe("claim fencing and delivery states", () => {
  it("builds phase markers with one token and exact ISO claim time", () => {
    assert.deepEqual(createDeliveryClaimMarkers(NOW, CLAIM_TOKEN), {
      claimed: `claim:v1:${CLAIM_TOKEN}:${NOW.toISOString()}:CLAIMED`,
      claimedAt: NOW,
      sending: `claim:v1:${CLAIM_TOKEN}:${NOW.toISOString()}:SENDING`,
      token: CLAIM_TOKEN,
    });
  });

  it("strictly parses current claim markers without accepting malformed timestamps", () => {
    const marker = createDeliveryClaimMarkers(NOW, CLAIM_TOKEN).sending;
    assert.deepEqual(parseDeliveryClaimMarker(marker), {
      claimedAt: NOW,
      marker,
      phase: "SENDING",
    });
    assert.equal(parseDeliveryClaimMarker(marker.replace(".000Z", "Z")), null);
    assert.equal(parseDeliveryClaimMarker("claim:v1:not-a-token:secret:SENDING"), null);
  });

  it("allows two concurrent jobs to claim once and send once", async () => {
    const repository = new FakeRepository();
    const transport = new FakeTransport();
    const [left, right] = await Promise.all([
      processNotificationDeliveryJob(job(), processorOptions(repository, { transport })),
      processNotificationDeliveryJob(job(), processorOptions(repository, { transport })),
    ]);
    assert.deepEqual(new Set([left, right]), new Set(["SENT", "NOT_CLAIMED"]));
    assert.deepEqual(transport.sent, ["one"]);
    assert.equal(repository.status, "SENT");
    assert.deepEqual(repository.sentAt, NOW);
    assert.equal(repository.finalizeCalls[0]?.marker?.endsWith(":SENDING"), true);
  });

  it("cancels stale preparation and zero-endpoint deliveries before SENDING", async () => {
    const staleRepository = new FakeRepository();
    const staleTransport = new FakeTransport();
    assert.equal(
      await processNotificationDeliveryJob(
        job(),
        processorOptions(staleRepository, {
          preparer: new FakePreparer(() => {
            throw new StaleClaimedNotificationError("PREFERENCE_DISABLED");
          }),
          transport: staleTransport,
        }),
      ),
      "CANCELLED",
    );
    assert.deepEqual(staleTransport.sent, []);
    assert.equal(staleRepository.finalizeCalls[0]?.marker?.endsWith(":CLAIMED"), true);
    assert.equal(staleRepository.sentAt, null);

    const noEndpointRepository = new FakeRepository();
    noEndpointRepository.subscriptions = [];
    assert.equal(
      await processNotificationDeliveryJob(job(), processorOptions(noEndpointRepository)),
      "CANCELLED",
    );
    assert.equal(noEndpointRepository.sentAt, null);
  });

  it("marks an unexpected pre-network preparation error FAILED from CLAIMED", async () => {
    const repository = new FakeRepository();
    const transport = new FakeTransport();
    assert.equal(
      await processNotificationDeliveryJob(
        job(),
        processorOptions(repository, {
          preparer: new FakePreparer(() => {
            throw new Error("internal-secret-must-not-leak");
          }),
          transport,
        }),
      ),
      "FAILED",
    );
    assert.deepEqual(transport.sent, []);
    assert.equal(repository.status, "FAILED");
    assert.equal(repository.sentAt, null);
    assert.equal(repository.finalizeCalls[0]?.marker?.endsWith(":CLAIMED"), true);
  });

  it("marks partial multi-device success SENT and total failure FAILED", async () => {
    const partialRepository = new FakeRepository();
    partialRepository.subscriptions = [subscription("one"), subscription("two")];
    const partialTransport = new FakeTransport(new Set(["two"]));
    assert.equal(
      await processNotificationDeliveryJob(
        job(),
        processorOptions(partialRepository, { transport: partialTransport }),
      ),
      "SENT",
    );
    assert.equal(partialRepository.status, "SENT");
    assert.deepEqual(partialRepository.sentAt, NOW);

    const failedRepository = new FakeRepository();
    failedRepository.subscriptions = [subscription("one"), subscription("two")];
    const failedTransport = new FakeTransport(new Set(["one", "two"]));
    assert.equal(
      await processNotificationDeliveryJob(
        job(),
        processorOptions(failedRepository, { transport: failedTransport }),
      ),
      "FAILED",
    );
    assert.equal(failedRepository.status, "FAILED");
    assert.equal(failedRepository.sentAt, null);
  });

  it("retries only the temporarily failing endpoint and never resends a success", async () => {
    const repository = new FakeRepository();
    repository.subscriptions = [subscription("one"), subscription("two")];
    const attempts = new Map<string, number>();
    const delays: number[] = [];
    const transport: NotificationTransport = {
      send: async (pushSubscription) => {
        const attempt = (attempts.get(pushSubscription.id) ?? 0) + 1;
        attempts.set(pushSubscription.id, attempt);
        if (pushSubscription.id === "two" && attempt < 3) {
          throw { statusCode: 503 };
        }
      },
    };

    assert.equal(
      await processNotificationDeliveryJob(
        job(),
        processorOptions(repository, {
          retrySleeper: async (delay) => {
            delays.push(delay);
          },
          transport,
        }),
      ),
      "SENT",
    );
    assert.deepEqual(Object.fromEntries(attempts), { one: 1, two: 3 });
    assert.deepEqual(delays, [2_000, 4_000]);
    assert.deepEqual(repository.revokedSubscriptionIds, []);
  });

  it("revokes 404/410 subscriptions without retry and cancels when all are invalid", async () => {
    const repository = new FakeRepository();
    repository.subscriptions = [subscription("one"), subscription("two")];
    const calls: string[] = [];
    const outcome = await processNotificationDeliveryJob(
      job(),
      processorOptions(repository, {
        transport: {
          send: async (pushSubscription) => {
            calls.push(pushSubscription.id);
            throw { statusCode: pushSubscription.id === "one" ? 404 : 410 };
          },
        },
      }),
    );

    assert.equal(outcome, "CANCELLED");
    assert.deepEqual(calls, ["one", "two"]);
    assert.deepEqual(repository.revokedSubscriptionIds, ["one", "two"]);
    assert.equal(repository.marker, "stale:ALL_SUBSCRIPTIONS_REVOKED");
  });

  it("dead-letters exhausted, permanent and indeterminate failures without leaking errors", async () => {
    for (const error of [{ statusCode: 503 }, { statusCode: 400 }, new Error("private-endpoint")]) {
      const repository = new FakeRepository();
      const entries: unknown[] = [];
      const logger: DeliveryLogger = {
        error: (fields, message) => entries.push({ fields, message }),
        info: (fields, message) => entries.push({ fields, message }),
      };
      let calls = 0;
      assert.equal(
        await processNotificationDeliveryJob(
          job(),
          processorOptions(repository, {
            logger,
            retrySleeper: async () => undefined,
            transport: {
              send: async () => {
                calls += 1;
                throw error;
              },
            },
          }),
        ),
        "FAILED",
      );
      assert.equal(calls, "statusCode" in error && error.statusCode === 503 ? 3 : 1);
      assert.match(repository.marker ?? "", /^dead-letter:v1:/u);
      const serialized = JSON.stringify(entries);
      assert.match(serialized, /Notification delivery dead-lettered/u);
      assert.doesNotMatch(serialized, /private-endpoint|statusCode/u);
      assert.deepEqual(repository.revokedSubscriptionIds, []);
    }
  });

  it("never sends after a changed fence between prepare and promote", async () => {
    const repository = new FakeRepository();
    const transport = new FakeTransport();
    const preparer = new FakePreparer((identity) => {
      repository.marker = "claim:v1:another-fence:SENDING";
      return payload(identity.notificationType);
    });
    assert.equal(
      await processNotificationDeliveryJob(
        job(),
        processorOptions(repository, { preparer, transport }),
      ),
      "LOST_FENCE",
    );
    assert.deepEqual(transport.sent, []);
    assert.equal(repository.status, "PROCESSING");
  });

  it("validates the completion clock and leaves an indeterminate send fenced as SENDING", async () => {
    const repository = new FakeRepository();
    const transport = new FakeTransport();
    let clockCalls = 0;
    await assert.rejects(
      processNotificationDeliveryJob(job(), {
        ...processorOptions(repository, { transport }),
        clock: () => {
          clockCalls += 1;
          return clockCalls === 1 ? NOW : new Date("invalid");
        },
      }),
      /valid clock/iu,
    );
    assert.deepEqual(transport.sent, ["one"]);
    assert.equal(repository.status, "PROCESSING");
    assert.equal(repository.marker?.endsWith(":SENDING"), true);
  });

  it("does not reclaim a crash-left PROCESSING row on redelivery", async () => {
    const repository = new FakeRepository();
    const markers = createDeliveryClaimMarkers(NOW, CLAIM_TOKEN);
    assert.equal(await repository.claimScheduledDelivery(DELIVERY_ID, NOW, markers.claimed), true);
    const transport = new FakeTransport();
    assert.equal(
      await processNotificationDeliveryJob(job(), processorOptions(repository, { transport })),
      "NOT_CLAIMED",
    );
    assert.equal(repository.status, "PROCESSING");
    assert.equal(repository.marker, markers.claimed);
    assert.deepEqual(transport.sent, []);
  });

  it("uses exact id, PROCESSING state, and marker for finalization fencing", async () => {
    let updateQuery: Record<string, unknown> | undefined;
    const client = {
      notificationDelivery: {
        updateMany: async (query: Record<string, unknown>) => {
          updateQuery = query;
          return { count: 0 };
        },
      },
    };
    const repository = new PrismaNotificationDeliveryRepository(client as never);
    assert.equal(
      await repository.finalizeClaimedDelivery(
        DELIVERY_ID,
        "claim:v1:bad-marker:SENDING",
        "SENT",
        NOW,
        null,
      ),
      false,
    );
    assert.deepEqual(updateQuery?.where, {
      errorMessage: "claim:v1:bad-marker:SENDING",
      id: DELIVERY_ID,
      status: "PROCESSING",
    });
  });

  it("claims only the exact due SCHEDULED row and writes its PROCESSING marker", async () => {
    let updateQuery: Record<string, unknown> | undefined;
    const client = {
      notificationDelivery: {
        updateMany: async (query: Record<string, unknown>) => {
          updateQuery = query;
          return { count: 1 };
        },
      },
    };
    const repository = new PrismaNotificationDeliveryRepository(client as never);
    const marker = createDeliveryClaimMarkers(NOW, CLAIM_TOKEN).claimed;
    assert.equal(await repository.claimScheduledDelivery(DELIVERY_ID, NOW, marker), true);
    assert.deepEqual(updateQuery, {
      data: {
        errorMessage: marker,
        sentAt: null,
        status: "PROCESSING",
      },
      where: {
        id: DELIVERY_ID,
        scheduledFor: { lte: NOW },
        status: "SCHEDULED",
      },
    });
  });

  it("routes every supported claimed type through its real preparation adapter", async () => {
    const calls: string[] = [];
    const preparer = new PrismaClaimedNotificationPreparer({} as never, {
      dateChange: {
        findDateChangeDeliveryRecord: async (deliveryId) => {
          calls.push(`date:${deliveryId}`);
          return dateChangeRecord();
        },
      },
      deadline: {
        findDeadlineReminderRecord: async (deliveryId) => {
          calls.push(`deadline:${deliveryId}`);
          return deadlineRecord();
        },
      },
      opening: {
        findOpeningReminderRecord: async (deliveryId) => {
          calls.push(`opening:${deliveryId}`);
          return openingRecord();
        },
      },
    });

    for (const notificationType of [
      "APPLICATION_OPENING",
      "APPLICATION_DEADLINE",
      "DATE_CHANGED",
    ] as const) {
      const prepared = await preparer.prepare(
        DELIVERY_ID,
        { notificationType, userId: USER_ID },
        NOW,
      );
      assert.equal(prepared.userId, USER_ID);
      assert.equal(prepared.payload.type, notificationType);
      assert.equal(prepared.payload.deepLink, `/programs/${PROGRAM_ID}`);
      assert.match(prepared.payload.dedupeKey, /^athenvia:/u);
    }
    assert.deepEqual(calls, [
      `opening:${DELIVERY_ID}`,
      `deadline:${DELIVERY_ID}`,
      `date:${DELIVERY_ID}`,
    ]);
  });

  it("logs only delivery summaries, never subscription or transport secrets", async () => {
    const repository = new FakeRepository();
    repository.subscriptions = [subscription("one"), subscription("two")];
    const logEntries: unknown[] = [];
    const logger: DeliveryLogger = {
      error: (fields, message) => logEntries.push({ fields, message }),
      info: (fields, message) => logEntries.push({ fields, message }),
    };
    await processNotificationDeliveryJob(
      job(),
      processorOptions(repository, {
        logger,
        transport: new FakeTransport(new Set(["two"])),
      }),
    );
    const serialized = JSON.stringify(logEntries);
    assert.doesNotMatch(serialized, /auth-secret|p256dh-secret|push\.example|private=endpoint/iu);
    assert.match(serialized, /sent/iu);
  });
});

describe("notification claim recovery", () => {
  it("recovers stale CLAIMED work but never retries an indeterminate SENDING claim", async () => {
    const claimedRepository = new FakeRepository();
    claimedRepository.status = "PROCESSING";
    const oldClaimedAt = new Date(NOW.getTime() - STALE_NOTIFICATION_CLAIM_MILLISECONDS);
    claimedRepository.marker = createDeliveryClaimMarkers(oldClaimedAt, CLAIM_TOKEN).claimed;
    assert.deepEqual(
      await recoverStaleNotificationDeliveries({
        now: NOW,
        repository: claimedRepository,
      }),
      { quarantinedCount: 0, recoveredCount: 1, scannedCount: 1 },
    );
    assert.equal(claimedRepository.status, "SCHEDULED");
    assert.equal(claimedRepository.marker, "retry:v1:stale-claimed");

    const sendingRepository = new FakeRepository();
    sendingRepository.status = "PROCESSING";
    sendingRepository.marker = createDeliveryClaimMarkers(oldClaimedAt, CLAIM_TOKEN).sending;
    assert.deepEqual(
      await recoverStaleNotificationDeliveries({
        now: NOW,
        repository: sendingRepository,
      }),
      { quarantinedCount: 1, recoveredCount: 0, scannedCount: 1 },
    );
    assert.equal(sendingRepository.status, "FAILED");
    assert.equal(sendingRepository.marker, "dead-letter:v1:indeterminate-send");
  });

  it("leaves fresh claims untouched and quarantines corrupt PROCESSING markers", async () => {
    const freshRepository = new FakeRepository();
    freshRepository.status = "PROCESSING";
    freshRepository.marker = createDeliveryClaimMarkers(NOW, CLAIM_TOKEN).claimed;
    assert.deepEqual(
      await recoverStaleNotificationDeliveries({
        now: NOW,
        repository: freshRepository,
      }),
      { quarantinedCount: 0, recoveredCount: 0, scannedCount: 1 },
    );
    assert.equal(freshRepository.status, "PROCESSING");

    const corruptRepository = new FakeRepository();
    corruptRepository.status = "PROCESSING";
    corruptRepository.marker = null;
    assert.deepEqual(
      await recoverStaleNotificationDeliveries({
        now: NOW,
        repository: corruptRepository,
      }),
      { quarantinedCount: 1, recoveredCount: 0, scannedCount: 1 },
    );
    assert.equal(corruptRepository.status, "FAILED");
    assert.equal(corruptRepository.marker, "dead-letter:v1:invalid-claim-marker");
  });

  it("uses exact PROCESSING markers for reset recovery fencing", async () => {
    let updateQuery: Record<string, unknown> | undefined;
    const client = {
      notificationDelivery: {
        updateMany: async (query: Record<string, unknown>) => {
          updateQuery = query;
          return { count: 1 };
        },
      },
    };
    const repository = new PrismaNotificationDeliveryRepository(client as never);
    const marker = createDeliveryClaimMarkers(NOW, CLAIM_TOKEN).claimed;
    assert.equal(
      await repository.resetStaleClaimedDelivery(DELIVERY_ID, marker, "retry:v1:stale-claimed"),
      true,
    );
    assert.deepEqual(updateQuery, {
      data: {
        errorMessage: "retry:v1:stale-claimed",
        sentAt: null,
        status: "SCHEDULED",
      },
      where: {
        errorMessage: marker,
        id: DELIVERY_ID,
        status: "PROCESSING",
      },
    });
  });

  it("reads a bounded deterministic PROCESSING recovery batch", async () => {
    let findQuery: Record<string, unknown> | undefined;
    const client = {
      notificationDelivery: {
        findMany: async (query: Record<string, unknown>) => {
          findQuery = query;
          return [{ errorMessage: "marker", id: DELIVERY_ID }];
        },
      },
    };
    const repository = new PrismaNotificationDeliveryRepository(client as never);
    assert.deepEqual(await repository.listProcessingDeliveryClaims(25), [
      { deliveryId: DELIVERY_ID, marker: "marker" },
    ]);
    assert.deepEqual(findQuery, {
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      select: {
        errorMessage: true,
        id: true,
      },
      take: 25,
      where: {
        status: "PROCESSING",
      },
    });
  });
});

describe("Web Push transport", () => {
  it("uses a short deterministic topic and a minimal deep-link payload", async () => {
    const calls: Array<{
      options: Record<string, unknown>;
      payload: string | undefined;
      subscription: unknown;
    }> = [];
    const sender: WebPushSender = {
      sendNotification: async (pushSubscription: unknown, body?: string, options?) => {
        calls.push({
          options: { ...options },
          payload: body,
          subscription: pushSubscription,
        });
      },
    };
    const configuration = {
      privateKey: "private-test-key",
      publicKey: "public-test-key",
      subject: "mailto:push@example.test",
    };
    const transport = new WebPushNotificationTransport(configuration, sender, async () => [
      "93.184.216.34",
    ]);
    await transport.send(subscription("one"), payload());
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.options.TTL, WEB_PUSH_TTL_SECONDS);
    assert.equal(calls[0]?.options.timeout, WEB_PUSH_TIMEOUT_MILLISECONDS);
    assert.equal(calls[0]?.options.urgency, "normal");
    assert.equal(calls[0]?.options.topic, createWebPushTopic(payload().dedupeKey));
    assert.ok(createWebPushTopic(payload().dedupeKey).length <= 32);
    assert.deepEqual(JSON.parse(calls[0]?.payload ?? "{}"), {
      body: payload().body,
      dedupeKey: payload().dedupeKey,
      deepLink: `/programs/${PROGRAM_ID}`,
      title: payload().title,
    });
    assert.doesNotMatch(calls[0]?.payload ?? "", /auth-secret|p256dh-secret|push\.example/iu);
    assert.equal(minimalWebPushPayload(payload()), calls[0]?.payload);
  });

  it("loads the CommonJS web-push sender through its ESM default export", async () => {
    const imported = await import("web-push");
    assert.equal(typeof imported.default.sendNotification, "function");
  });
});
