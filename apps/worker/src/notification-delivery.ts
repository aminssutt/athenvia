import { randomUUID } from "node:crypto";

import { NotificationPayloadSchema } from "@athenvia/contracts";
import { database, revokeInvalidPushSubscriptions } from "@athenvia/database";

import {
  DateChangeNotificationError,
  prepareDateChangeNotificationJob,
  PrismaDateChangeNotificationRepository,
  type DateChangeNotificationRepository,
} from "./notifications/date-change-notifications";
import {
  DeadlineReminderPreparationError,
  prepareDeadlineReminderJob,
  PrismaDeadlineReminderJobRepository,
  type DeadlineReminderJobRepository,
} from "./notifications/deadline-reminders";
import {
  OpeningReminderPreparationError,
  prepareOpeningReminderJob,
  PrismaOpeningReminderJobRepository,
  type OpeningReminderJobRepository,
} from "./notifications/opening-reminders";
import {
  notificationDeliveryQueueContract,
  NotificationDeliveryJobDataSchema,
  type NotificationDeliveryJobData,
} from "./queue-contracts";
import { deliverWebPushWithRetry, type PushRetrySleeper } from "./notifications/push-retries";

import type { NotificationPayload } from "@athenvia/contracts";
import type { NotificationType } from "@athenvia/database";
import type { ActivePushSubscription, NotificationTransport } from "./web-push-transport";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const CLAIM_MARKER_PREFIX = "claim:v1";
export const STALE_NOTIFICATION_CLAIM_MILLISECONDS = 5 * 60_000;

export type ClaimPhase = "CLAIMED" | "SENDING";

export interface DeliveryClaimMarkers {
  claimed: string;
  claimedAt: Date;
  sending: string;
  token: string;
}

export interface ClaimedDeliveryIdentity {
  notificationType: NotificationType;
  userId: string;
}

export interface PreparedClaimedNotification {
  payload: NotificationPayload;
  userId: string;
}

export interface ProcessingDeliveryClaim {
  deliveryId: string;
  marker: string | null;
}

export interface NotificationDeliveryRepository {
  claimScheduledDelivery(deliveryId: string, claimedAt: Date, marker: string): Promise<boolean>;
  finalizeClaimedDelivery(
    deliveryId: string,
    marker: string | null,
    status: "CANCELLED" | "FAILED" | "SENT",
    completedAt: Date,
    safeMessage: string | null,
  ): Promise<boolean>;
  listActivePushSubscriptions(userId: string): Promise<ActivePushSubscription[]>;
  listDueScheduledDeliveryIds(now: Date, limit: number): Promise<string[]>;
  listProcessingDeliveryClaims(limit: number): Promise<ProcessingDeliveryClaim[]>;
  loadClaimedDeliveryIdentity(
    deliveryId: string,
    marker: string,
  ): Promise<ClaimedDeliveryIdentity | null>;
  promoteClaimToSending(
    deliveryId: string,
    claimedMarker: string,
    sendingMarker: string,
  ): Promise<boolean>;
  resetStaleClaimedDelivery(
    deliveryId: string,
    claimedMarker: string,
    safeMessage: string,
  ): Promise<boolean>;
  revokeInvalidPushSubscriptions(
    userId: string,
    subscriptionIds: string[],
    revokedAt: Date,
  ): Promise<number>;
}

export interface ClaimedNotificationPreparer {
  prepare(
    deliveryId: string,
    identity: ClaimedDeliveryIdentity,
    now: Date,
  ): Promise<PreparedClaimedNotification>;
}

export interface ClaimedNotificationPreparationRepositories {
  dateChange: Pick<DateChangeNotificationRepository, "findDateChangeDeliveryRecord">;
  deadline: Pick<DeadlineReminderJobRepository, "findDeadlineReminderRecord">;
  opening: Pick<OpeningReminderJobRepository, "findOpeningReminderRecord">;
}

export interface DeliveryQueue {
  add(
    name: string,
    data: NotificationDeliveryJobData,
    options: { attempts: 1; jobId: string },
  ): Promise<unknown>;
}

export interface DeliveryLogger {
  error(fields: Record<string, unknown>, message: string): void;
  info(fields: Record<string, unknown>, message: string): void;
}

export interface DeliveryJob {
  data: unknown;
  id?: string;
  name: string;
}

export type NotificationDeliveryOutcome =
  "CANCELLED" | "FAILED" | "LOST_FENCE" | "LOST_FENCE_AFTER_SEND" | "NOT_CLAIMED" | "SENT";

export interface ProcessNotificationDeliveryOptions {
  clock?: () => Date;
  logger?: DeliveryLogger;
  preparer: ClaimedNotificationPreparer;
  repository: NotificationDeliveryRepository;
  retrySleeper?: PushRetrySleeper;
  tokenFactory?: () => string;
  transport: NotificationTransport;
}

export interface RecoverStaleNotificationDeliveriesOptions {
  limit?: number;
  now?: Date;
  repository: NotificationDeliveryRepository;
  staleAfterMilliseconds?: number;
}

export interface RecoverStaleNotificationDeliveriesResult {
  quarantinedCount: number;
  recoveredCount: number;
  scannedCount: number;
}

export interface DispatchDueNotificationDeliveriesOptions {
  limit?: number;
  now?: Date;
  queue: DeliveryQueue;
  repository: NotificationDeliveryRepository;
}

export interface DispatchDueNotificationDeliveriesResult {
  deliveryIds: string[];
  queuedCount: number;
}

export class StaleClaimedNotificationError extends Error {
  constructor(readonly code: string) {
    super("The claimed notification no longer satisfies delivery invariants.");
    this.name = "StaleClaimedNotificationError";
  }
}

export interface ParsedDeliveryClaimMarker {
  claimedAt: Date;
  marker: string;
  phase: ClaimPhase;
}

function assertClock(value: Date): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError("Notification delivery requires a valid clock.");
  }
}

function assertToken(value: string): void {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError("Notification delivery claim tokens must be UUIDs.");
  }
}

export function createDeliveryClaimMarkers(
  claimedAt: Date,
  token: string = randomUUID(),
): DeliveryClaimMarkers {
  assertClock(claimedAt);
  assertToken(token);
  const base = `${CLAIM_MARKER_PREFIX}:${token}:${claimedAt.toISOString()}`;
  return {
    claimed: `${base}:CLAIMED`,
    claimedAt: new Date(claimedAt.getTime()),
    sending: `${base}:SENDING`,
    token,
  };
}

export function parseDeliveryClaimMarker(marker: string): ParsedDeliveryClaimMarker | null {
  const match =
    /^claim:v1:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:(.+):(CLAIMED|SENDING)$/iu.exec(
      marker,
    );
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const claimedAt = new Date(match[1]);
  if (!Number.isFinite(claimedAt.getTime()) || claimedAt.toISOString() !== match[1]) {
    return null;
  }
  return {
    claimedAt,
    marker,
    phase: match[2] as ClaimPhase,
  };
}

export class PrismaNotificationDeliveryRepository implements NotificationDeliveryRepository {
  constructor(private readonly client: typeof database = database) {}

  async listDueScheduledDeliveryIds(now: Date, limit: number): Promise<string[]> {
    const deliveries = await this.client.notificationDelivery.findMany({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      select: { id: true },
      take: limit,
      where: {
        scheduledFor: { lte: now },
        status: "SCHEDULED",
      },
    });
    return deliveries.map(({ id }) => id);
  }

  async listProcessingDeliveryClaims(limit: number): Promise<ProcessingDeliveryClaim[]> {
    const deliveries = await this.client.notificationDelivery.findMany({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      select: {
        errorMessage: true,
        id: true,
      },
      take: limit,
      where: {
        status: "PROCESSING",
      },
    });
    return deliveries.map(({ errorMessage, id }) => ({
      deliveryId: id,
      marker: errorMessage,
    }));
  }

  async claimScheduledDelivery(
    deliveryId: string,
    claimedAt: Date,
    marker: string,
  ): Promise<boolean> {
    const result = await this.client.notificationDelivery.updateMany({
      data: {
        errorMessage: marker,
        sentAt: null,
        status: "PROCESSING",
      },
      where: {
        id: deliveryId,
        scheduledFor: { lte: claimedAt },
        status: "SCHEDULED",
      },
    });
    return result.count === 1;
  }

  async loadClaimedDeliveryIdentity(
    deliveryId: string,
    marker: string,
  ): Promise<ClaimedDeliveryIdentity | null> {
    return this.client.notificationDelivery.findFirst({
      select: {
        notificationType: true,
        userId: true,
      },
      where: {
        errorMessage: marker,
        id: deliveryId,
        status: "PROCESSING",
      },
    });
  }

  async listActivePushSubscriptions(userId: string): Promise<ActivePushSubscription[]> {
    return this.client.pushSubscription.findMany({
      orderBy: { id: "asc" },
      select: {
        auth: true,
        endpoint: true,
        id: true,
        p256dh: true,
      },
      where: {
        revokedAt: null,
        userId,
      },
    });
  }

  async promoteClaimToSending(
    deliveryId: string,
    claimedMarker: string,
    sendingMarker: string,
  ): Promise<boolean> {
    const result = await this.client.notificationDelivery.updateMany({
      data: { errorMessage: sendingMarker },
      where: {
        errorMessage: claimedMarker,
        id: deliveryId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }

  async finalizeClaimedDelivery(
    deliveryId: string,
    marker: string | null,
    status: "CANCELLED" | "FAILED" | "SENT",
    completedAt: Date,
    safeMessage: string | null,
  ): Promise<boolean> {
    const result = await this.client.notificationDelivery.updateMany({
      data: {
        errorMessage: safeMessage,
        sentAt: status === "SENT" ? completedAt : null,
        status,
      },
      where: {
        errorMessage: marker,
        id: deliveryId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }

  async resetStaleClaimedDelivery(
    deliveryId: string,
    claimedMarker: string,
    safeMessage: string,
  ): Promise<boolean> {
    const result = await this.client.notificationDelivery.updateMany({
      data: {
        errorMessage: safeMessage,
        sentAt: null,
        status: "SCHEDULED",
      },
      where: {
        errorMessage: claimedMarker,
        id: deliveryId,
        status: "PROCESSING",
      },
    });
    return result.count === 1;
  }

  async revokeInvalidPushSubscriptions(
    userId: string,
    subscriptionIds: string[],
    revokedAt: Date,
  ): Promise<number> {
    return revokeInvalidPushSubscriptions(
      {
        revokedAt,
        subscriptionIds,
        userId,
      },
      this.client,
    );
  }
}

export const prismaNotificationDeliveryRepository = new PrismaNotificationDeliveryRepository();

function asStalePreparationError(error: unknown): StaleClaimedNotificationError | null {
  if (
    error instanceof OpeningReminderPreparationError ||
    error instanceof DeadlineReminderPreparationError ||
    error instanceof DateChangeNotificationError
  ) {
    return new StaleClaimedNotificationError(error.code);
  }
  return null;
}

export class PrismaClaimedNotificationPreparer implements ClaimedNotificationPreparer {
  private readonly openingRepository: ClaimedNotificationPreparationRepositories["opening"];
  private readonly deadlineRepository: ClaimedNotificationPreparationRepositories["deadline"];
  private readonly dateChangeRepository: ClaimedNotificationPreparationRepositories["dateChange"];

  constructor(
    client: typeof database = database,
    repositories?: ClaimedNotificationPreparationRepositories,
  ) {
    this.openingRepository =
      repositories?.opening ?? new PrismaOpeningReminderJobRepository(client);
    this.deadlineRepository =
      repositories?.deadline ?? new PrismaDeadlineReminderJobRepository(client);
    this.dateChangeRepository =
      repositories?.dateChange ?? new PrismaDateChangeNotificationRepository(client);
  }

  async prepare(
    deliveryId: string,
    identity: ClaimedDeliveryIdentity,
    now: Date,
  ): Promise<PreparedClaimedNotification> {
    try {
      let prepared: PreparedClaimedNotification;
      if (identity.notificationType === "APPLICATION_OPENING") {
        const record = await this.openingRepository.findOpeningReminderRecord(deliveryId);
        if (record === null) {
          throw new StaleClaimedNotificationError("DELIVERY_NOT_FOUND");
        }
        const job = prepareOpeningReminderJob({ ...record, status: "SCHEDULED" }, now);
        prepared = { payload: job.payload, userId: job.userId };
      } else if (identity.notificationType === "APPLICATION_DEADLINE") {
        const record = await this.deadlineRepository.findDeadlineReminderRecord(deliveryId);
        if (record === null) {
          throw new StaleClaimedNotificationError("DELIVERY_NOT_FOUND");
        }
        const job = prepareDeadlineReminderJob({ ...record, status: "SCHEDULED" }, now);
        prepared = { payload: job.payload, userId: job.userId };
      } else if (identity.notificationType === "DATE_CHANGED") {
        const record = await this.dateChangeRepository.findDateChangeDeliveryRecord(deliveryId);
        if (record === null) {
          throw new StaleClaimedNotificationError("DELIVERY_NOT_FOUND");
        }
        const job = prepareDateChangeNotificationJob({ ...record, status: "SCHEDULED" }, now);
        prepared = { payload: job.payload, userId: job.userId };
      } else {
        throw new StaleClaimedNotificationError("UNSUPPORTED_NOTIFICATION_TYPE");
      }

      if (prepared.userId !== identity.userId) {
        throw new StaleClaimedNotificationError("DELIVERY_OWNER_MISMATCH");
      }
      const payload = NotificationPayloadSchema.parse({
        ...prepared.payload,
        deepLink: `/programs/${prepared.payload.programId}`,
      });
      return { payload, userId: prepared.userId };
    } catch (error) {
      if (error instanceof StaleClaimedNotificationError) {
        throw error;
      }
      const stale = asStalePreparationError(error);
      if (stale !== null) {
        throw stale;
      }
      throw error;
    }
  }
}

export const prismaClaimedNotificationPreparer = new PrismaClaimedNotificationPreparer();

export async function dispatchDueNotificationDeliveries(
  options: DispatchDueNotificationDeliveriesOptions,
): Promise<DispatchDueNotificationDeliveriesResult> {
  const now = options.now ?? new Date();
  assertClock(now);
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("Notification delivery dispatch limit must be between 1 and 1000.");
  }
  const deliveryIds = await options.repository.listDueScheduledDeliveryIds(now, limit);
  for (const deliveryId of deliveryIds) {
    const data = NotificationDeliveryJobDataSchema.parse({ deliveryId });
    await options.queue.add(notificationDeliveryQueueContract.jobName, data, {
      attempts: 1,
      jobId: deliveryId,
    });
  }
  return { deliveryIds, queuedCount: deliveryIds.length };
}

export async function recoverStaleNotificationDeliveries(
  options: RecoverStaleNotificationDeliveriesOptions,
): Promise<RecoverStaleNotificationDeliveriesResult> {
  const now = options.now ?? new Date();
  assertClock(now);
  const limit = options.limit ?? 1_000;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("Notification recovery limit must be between 1 and 1000.");
  }
  const staleAfterMilliseconds =
    options.staleAfterMilliseconds ?? STALE_NOTIFICATION_CLAIM_MILLISECONDS;
  if (!Number.isInteger(staleAfterMilliseconds) || staleAfterMilliseconds < 1) {
    throw new RangeError("Notification recovery requires a positive stale threshold.");
  }

  const claims = await options.repository.listProcessingDeliveryClaims(limit);
  let quarantinedCount = 0;
  let recoveredCount = 0;
  for (const claim of claims) {
    const parsed = claim.marker === null ? null : parseDeliveryClaimMarker(claim.marker);
    if (parsed === null) {
      const quarantined = await options.repository.finalizeClaimedDelivery(
        claim.deliveryId,
        claim.marker,
        "FAILED",
        now,
        "dead-letter:v1:invalid-claim-marker",
      );
      quarantinedCount += quarantined ? 1 : 0;
      continue;
    }
    if (now.getTime() - parsed.claimedAt.getTime() < staleAfterMilliseconds) {
      continue;
    }
    if (parsed.phase === "CLAIMED") {
      const recovered = await options.repository.resetStaleClaimedDelivery(
        claim.deliveryId,
        parsed.marker,
        "retry:v1:stale-claimed",
      );
      recoveredCount += recovered ? 1 : 0;
      continue;
    }
    const quarantined = await options.repository.finalizeClaimedDelivery(
      claim.deliveryId,
      parsed.marker,
      "FAILED",
      now,
      "dead-letter:v1:indeterminate-send",
    );
    quarantinedCount += quarantined ? 1 : 0;
  }
  return {
    quarantinedCount,
    recoveredCount,
    scannedCount: claims.length,
  };
}

async function failBeforeNetwork(
  deliveryId: string,
  markers: DeliveryClaimMarkers,
  now: Date,
  repository: NotificationDeliveryRepository,
): Promise<NotificationDeliveryOutcome> {
  const finalized = await repository.finalizeClaimedDelivery(
    deliveryId,
    markers.claimed,
    "FAILED",
    now,
    "dead-letter:v1:pre-network",
  );
  return finalized ? "FAILED" : "LOST_FENCE";
}

export async function processNotificationDeliveryJob(
  job: DeliveryJob,
  options: ProcessNotificationDeliveryOptions,
): Promise<NotificationDeliveryOutcome> {
  if (job.name !== notificationDeliveryQueueContract.jobName) {
    throw new TypeError("Unexpected notification delivery job name.");
  }
  const data = notificationDeliveryQueueContract.schema.parse(job.data);
  if (job.id !== data.deliveryId) {
    throw new TypeError("Notification delivery job ID must equal deliveryId.");
  }
  const now = (options.clock ?? (() => new Date()))();
  assertClock(now);
  const markers = createDeliveryClaimMarkers(now, options.tokenFactory?.());
  const claimed = await options.repository.claimScheduledDelivery(
    data.deliveryId,
    now,
    markers.claimed,
  );
  if (!claimed) {
    return "NOT_CLAIMED";
  }

  const identity = await options.repository.loadClaimedDeliveryIdentity(
    data.deliveryId,
    markers.claimed,
  );
  if (identity === null) {
    return "LOST_FENCE";
  }

  let prepared: PreparedClaimedNotification;
  let subscriptions: ActivePushSubscription[];
  try {
    prepared = await options.preparer.prepare(data.deliveryId, identity, now);
    subscriptions = await options.repository.listActivePushSubscriptions(prepared.userId);
  } catch (error) {
    if (error instanceof StaleClaimedNotificationError) {
      const finalized = await options.repository.finalizeClaimedDelivery(
        data.deliveryId,
        markers.claimed,
        "CANCELLED",
        now,
        `stale:${error.code}`,
      );
      return finalized ? "CANCELLED" : "LOST_FENCE";
    }
    options.logger?.error(
      { deliveryId: data.deliveryId },
      "Notification preparation failed before network delivery",
    );
    return failBeforeNetwork(data.deliveryId, markers, now, options.repository);
  }

  if (subscriptions.length === 0) {
    const finalized = await options.repository.finalizeClaimedDelivery(
      data.deliveryId,
      markers.claimed,
      "CANCELLED",
      now,
      "stale:NO_ACTIVE_SUBSCRIPTION",
    );
    return finalized ? "CANCELLED" : "LOST_FENCE";
  }

  const promoted = await options.repository.promoteClaimToSending(
    data.deliveryId,
    markers.claimed,
    markers.sending,
  );
  if (!promoted) {
    return "LOST_FENCE";
  }

  const results = await Promise.all(
    subscriptions.map(async (subscription) => ({
      outcome: await deliverWebPushWithRetry(
        () => options.transport.send(subscription, prepared.payload),
        options.retrySleeper,
      ),
      subscriptionId: subscription.id,
    })),
  );
  const completedAt = (options.clock ?? (() => new Date()))();
  assertClock(completedAt);
  const counts = {
    indeterminate: 0,
    invalidSubscription: 0,
    permanent: 0,
    sent: 0,
    transientExhausted: 0,
  };
  const invalidSubscriptionIds: string[] = [];
  for (const result of results) {
    switch (result.outcome.kind) {
      case "SENT":
        counts.sent += 1;
        break;
      case "INVALID_SUBSCRIPTION":
        counts.invalidSubscription += 1;
        invalidSubscriptionIds.push(result.subscriptionId);
        break;
      case "PERMANENT":
        counts.permanent += 1;
        break;
      case "TRANSIENT":
        counts.transientExhausted += 1;
        break;
      case "INDETERMINATE":
        counts.indeterminate += 1;
        break;
    }
  }
  if (invalidSubscriptionIds.length > 0) {
    await options.repository.revokeInvalidPushSubscriptions(
      prepared.userId,
      invalidSubscriptionIds,
      completedAt,
    );
  }
  const unresolvedCount = counts.indeterminate + counts.permanent + counts.transientExhausted;
  const finalStatus = counts.sent > 0 ? "SENT" : unresolvedCount === 0 ? "CANCELLED" : "FAILED";
  const safeSummary =
    `sent=${counts.sent};invalid=${counts.invalidSubscription};` +
    `transient=${counts.transientExhausted};permanent=${counts.permanent};` +
    `indeterminate=${counts.indeterminate}`;
  const safeMessage =
    finalStatus === "FAILED"
      ? `dead-letter:v1:${safeSummary}`
      : finalStatus === "CANCELLED"
        ? "stale:ALL_SUBSCRIPTIONS_REVOKED"
        : unresolvedCount > 0 || counts.invalidSubscription > 0
          ? `partial:v1:${safeSummary}`
          : null;
  const finalized = await options.repository.finalizeClaimedDelivery(
    data.deliveryId,
    markers.sending,
    finalStatus,
    completedAt,
    safeMessage,
  );
  if (finalStatus === "FAILED") {
    options.logger?.error(
      {
        deliveryId: data.deliveryId,
        ...counts,
      },
      "Notification delivery dead-lettered",
    );
  } else if (safeMessage?.startsWith("partial:")) {
    options.logger?.error(
      {
        deliveryId: data.deliveryId,
        ...counts,
      },
      "Notification delivery completed with endpoint failures",
    );
  }
  options.logger?.info(
    {
      deliveryId: data.deliveryId,
      finalStatus,
      subscriptionCount: subscriptions.length,
      ...counts,
    },
    "Notification delivery attempt completed",
  );
  if (!finalized) {
    return counts.sent > 0 ? "LOST_FENCE_AFTER_SEND" : "LOST_FENCE";
  }
  return finalStatus;
}
