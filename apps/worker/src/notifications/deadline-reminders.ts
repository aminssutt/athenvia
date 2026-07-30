import { DEFAULT_DEADLINE_REMINDER_DAYS, NotificationPayloadSchema } from "@athenvia/contracts";
import { database } from "@athenvia/database";

import { UTC_STORED_INSTANT_TIME_POLICY } from "./time-policy";
import type {
  ReminderDeliveryStatus,
  ReminderPublicDateStatus,
  ReminderTrackingStatus,
} from "./types";
import type { NotificationPayload } from "@athenvia/contracts";
import type { Prisma } from "@athenvia/database";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type DeadlineReminderOffset = 30 | 14 | 7 | 2;

export interface DueDeadlineReminderWindow {
  closesAt: Date | null;
  id: string;
  publicStatus: ReminderPublicDateStatus;
}

export interface DueDeadlineReminderRecord {
  applicationWindows: readonly DueDeadlineReminderWindow[];
  catalogueEligible: boolean;
  deadlinePreference: {
    beforeDeadlineDays: readonly number[];
  };
  dedupeKey: string;
  deliveryId: string;
  hasActivePushSubscription: boolean;
  intakeProgramId: string;
  notificationType:
    "APPLICATION_OPENING" | "APPLICATION_DEADLINE" | "DATE_CHANGED" | "SUBMISSION_APPROVED";
  officialSourceCandidates: readonly string[];
  programId: string;
  programName: string;
  scheduledFor: Date;
  status: ReminderDeliveryStatus;
  trackingStatus: ReminderTrackingStatus;
  universityName: string;
  userId: string;
  watchlistId: string;
  watchlistOwnerUserId: string;
}

export interface ParsedDeadlineReminderKey {
  offsetDays: DeadlineReminderOffset;
  watchlistId: string;
  windowId: string;
}

export interface PreparedDeadlineReminderJob {
  deliveryId: string;
  jobId: string;
  officialSourceUrl: string;
  payload: NotificationPayload;
  userId: string;
}

export type DeadlineReminderRejectionCode =
  | "DATE_NOT_DELIVERABLE"
  | "DEADLINE_PASSED"
  | "INVALID_DEDUPE_KEY"
  | "INVALID_RECORD"
  | "MISSED_DELIVERY_WINDOW"
  | "NOT_DUE"
  | "NOT_SCHEDULED"
  | "OFFICIAL_SOURCE_MISSING"
  | "PREFERENCE_DISABLED"
  | "SCHEDULE_MISMATCH"
  | "WATCHLIST_INELIGIBLE"
  | "WINDOW_NOT_FOUND"
  | "WRONG_NOTIFICATION_TYPE";

export class DeadlineReminderPreparationError extends Error {
  constructor(
    readonly code: DeadlineReminderRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "DeadlineReminderPreparationError";
  }
}

export interface DeadlineReminderJobRepository {
  findDeadlineReminderRecord(deliveryId: string): Promise<DueDeadlineReminderRecord | null>;
  listDueDeadlineReminderRecords(now: Date, limit: number): Promise<DueDeadlineReminderRecord[]>;
}

export interface PrepareDueDeadlineReminderJobsOptions {
  limit?: number;
  now?: Date;
  repository?: DeadlineReminderJobRepository;
}

export interface RejectedDeadlineReminder {
  code: DeadlineReminderRejectionCode;
  deliveryId: string;
}

export interface PrepareDueDeadlineReminderJobsResult {
  jobs: PreparedDeadlineReminderJob[];
  rejected: RejectedDeadlineReminder[];
}

export interface PrepareDeadlineReminderByDeliveryIdOptions {
  now?: Date;
  repository?: DeadlineReminderJobRepository;
}

export type PrepareDeadlineReminderByDeliveryIdResult =
  | {
      deliveryId: string;
      status: "NOT_FOUND";
    }
  | {
      code: DeadlineReminderRejectionCode;
      deliveryId: string;
      status: "REJECTED";
    }
  | {
      job: PreparedDeadlineReminderJob;
      status: "READY";
    };

function compactLabel(value: string, maximumLength: number): string {
  let safeCharacters = "";
  for (const character of Array.from(value.normalize("NFKC"))) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
      safeCharacters += " ";
      continue;
    }
    if (
      codePoint === 0x00ad ||
      codePoint === 0x034f ||
      codePoint === 0x061c ||
      codePoint === 0x180e ||
      (codePoint >= 0x200b && codePoint <= 0x200f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2060 && codePoint <= 0x206f) ||
      codePoint === 0xfeff
    ) {
      continue;
    }
    safeCharacters += character;
  }
  const normalized = safeCharacters.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    throw new DeadlineReminderPreparationError(
      "INVALID_RECORD",
      "Deadline reminder labels cannot be empty.",
    );
  }
  if (normalized.length <= maximumLength) {
    return normalized;
  }
  let truncated = "";
  for (const codePoint of Array.from(normalized)) {
    if (truncated.length + codePoint.length > maximumLength - 1) {
      break;
    }
    truncated += codePoint;
  }
  return `${truncated.trimEnd()}…`;
}

function safeOfficialSource(candidates: readonly string[]): URL | null {
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (
        url.protocol === "https:" &&
        url.hostname !== "" &&
        url.port === "" &&
        url.username === "" &&
        url.password === ""
      ) {
        return url;
      }
    } catch {
      // Try the next source candidate.
    }
  }
  return null;
}

function formatUtcDate(value: Date): string {
  const month = MONTH_NAMES[value.getUTCMonth()];
  if (month === undefined) {
    throw new DeadlineReminderPreparationError(
      "INVALID_RECORD",
      "The application deadline is invalid.",
    );
  }
  return `${month} ${value.getUTCDate()}, ${value.getUTCFullYear()}`;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function deadlineTitle(
  programLabel: string,
  dateStatus: "CONFIRMED" | "EXPECTED",
  offsetDays: DeadlineReminderOffset,
): string {
  const prefix =
    dateStatus === "EXPECTED"
      ? `Expected application deadline in ${offsetDays} days`
      : `Application deadline in ${offsetDays} days`;
  return compactLabel(`${prefix}: ${compactLabel(programLabel, 74)}`, 120);
}

function deadlineBody(
  programLabel: string,
  sourceHost: string,
  closesAt: Date,
  dateStatus: "CONFIRMED" | "EXPECTED",
): string {
  const program = compactLabel(programLabel, 60);
  const source = compactLabel(sourceHost, 50);
  const date = formatUtcDate(closesAt);
  if (dateStatus === "EXPECTED") {
    return compactLabel(
      `${program} has an expected application deadline of ${date}. This deadline is expected, not confirmed. Program source: ${source}.`,
      240,
    );
  }
  return compactLabel(
    `${program} has a confirmed application deadline of ${date}. Official program source: ${source}.`,
    240,
  );
}

export function parseDeadlineReminderDedupeKey(
  dedupeKey: string,
): ParsedDeadlineReminderKey | null {
  const parts = dedupeKey.split(":");
  if (
    parts.length !== 7 ||
    parts[0] !== "athenvia" ||
    parts[1] !== "reminder" ||
    parts[2] !== "v1" ||
    parts[5] !== "deadline"
  ) {
    return null;
  }

  const watchlistId = parts[3];
  const windowId = parts[4];
  const offsetText = parts[6];
  const offsetDays =
    offsetText === "30"
      ? 30
      : offsetText === "14"
        ? 14
        : offsetText === "7"
          ? 7
          : offsetText === "2"
            ? 2
            : null;
  if (
    watchlistId === undefined ||
    windowId === undefined ||
    !UUID_PATTERN.test(watchlistId) ||
    !UUID_PATTERN.test(windowId) ||
    offsetDays === null
  ) {
    return null;
  }

  return {
    offsetDays,
    watchlistId,
    windowId,
  };
}

export function prepareDeadlineReminderJob(
  record: DueDeadlineReminderRecord,
  now: Date,
): PreparedDeadlineReminderJob {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new DeadlineReminderPreparationError(
      "INVALID_RECORD",
      "Deadline reminder preparation requires a valid clock.",
    );
  }
  if (record.status !== "SCHEDULED") {
    throw new DeadlineReminderPreparationError(
      "NOT_SCHEDULED",
      "Only scheduled notification deliveries can be prepared.",
    );
  }
  if (record.notificationType !== "APPLICATION_DEADLINE") {
    throw new DeadlineReminderPreparationError(
      "WRONG_NOTIFICATION_TYPE",
      "Only application-deadline deliveries are supported.",
    );
  }
  if (record.userId !== record.watchlistOwnerUserId) {
    throw new DeadlineReminderPreparationError(
      "INVALID_RECORD",
      "The notification delivery owner does not match the watchlist owner.",
    );
  }
  if (record.programId !== record.intakeProgramId) {
    throw new DeadlineReminderPreparationError(
      "INVALID_RECORD",
      "The watchlist program does not match its intake program.",
    );
  }
  if (
    !record.catalogueEligible ||
    record.trackingStatus === "APPLIED" ||
    !record.hasActivePushSubscription
  ) {
    throw new DeadlineReminderPreparationError(
      "WATCHLIST_INELIGIBLE",
      "The watchlist is no longer eligible for deadline reminders.",
    );
  }
  if (
    !(record.scheduledFor instanceof Date) ||
    !Number.isFinite(record.scheduledFor.getTime()) ||
    record.scheduledFor.getTime() > now.getTime()
  ) {
    throw new DeadlineReminderPreparationError("NOT_DUE", "The deadline reminder is not due.");
  }
  if (
    record.scheduledFor.getUTCFullYear() !== now.getUTCFullYear() ||
    record.scheduledFor.getUTCMonth() !== now.getUTCMonth() ||
    record.scheduledFor.getUTCDate() !== now.getUTCDate()
  ) {
    throw new DeadlineReminderPreparationError(
      "MISSED_DELIVERY_WINDOW",
      "The deadline reminder missed its UTC delivery day.",
    );
  }

  const parsedKey = parseDeadlineReminderDedupeKey(record.dedupeKey);
  if (parsedKey === null || parsedKey.watchlistId !== record.watchlistId) {
    throw new DeadlineReminderPreparationError(
      "INVALID_DEDUPE_KEY",
      "The delivery does not have a valid deadline-reminder dedupe key.",
    );
  }
  if (!record.deadlinePreference.beforeDeadlineDays.includes(parsedKey.offsetDays)) {
    throw new DeadlineReminderPreparationError(
      "PREFERENCE_DISABLED",
      "The deadline reminder offset is no longer enabled.",
    );
  }
  const window = record.applicationWindows.find(({ id }) => id === parsedKey.windowId);
  if (window === undefined) {
    throw new DeadlineReminderPreparationError(
      "WINDOW_NOT_FOUND",
      "The application window referenced by the delivery no longer exists.",
    );
  }
  if (
    !(window.closesAt instanceof Date) ||
    !Number.isFinite(window.closesAt.getTime()) ||
    (window.publicStatus !== "CONFIRMED" && window.publicStatus !== "EXPECTED")
  ) {
    throw new DeadlineReminderPreparationError(
      "DATE_NOT_DELIVERABLE",
      "The application deadline is not deliverable.",
    );
  }
  if (window.closesAt.getTime() <= now.getTime()) {
    throw new DeadlineReminderPreparationError(
      "DEADLINE_PASSED",
      "The application deadline has already passed.",
    );
  }

  const expectedSchedule = UTC_STORED_INSTANT_TIME_POLICY.reminderAt(
    window.closesAt,
    parsedKey.offsetDays,
  );
  if (expectedSchedule.getTime() !== record.scheduledFor.getTime()) {
    throw new DeadlineReminderPreparationError(
      "SCHEDULE_MISMATCH",
      "The delivery schedule no longer matches its application deadline.",
    );
  }

  const officialSource = safeOfficialSource(record.officialSourceCandidates);
  if (officialSource === null) {
    throw new DeadlineReminderPreparationError(
      "OFFICIAL_SOURCE_MISSING",
      "A valid official source is required for a deadline reminder.",
    );
  }

  try {
    const programLabel = `${record.programName} at ${record.universityName}`;
    const payload = NotificationPayloadSchema.parse({
      body: deadlineBody(
        programLabel,
        officialSource.hostname,
        window.closesAt,
        window.publicStatus,
      ),
      dateStatus: window.publicStatus,
      dedupeKey: record.dedupeKey,
      deepLink: `/programs/${record.programId}`,
      programId: record.programId,
      scheduledFor: record.scheduledFor.toISOString(),
      title: deadlineTitle(programLabel, window.publicStatus, parsedKey.offsetDays),
      type: "APPLICATION_DEADLINE",
      watchlistId: record.watchlistId,
    });
    return {
      deliveryId: record.deliveryId,
      jobId: record.deliveryId,
      officialSourceUrl: `${officialSource.origin}/`,
      payload,
      userId: record.userId,
    };
  } catch (error) {
    if (error instanceof DeadlineReminderPreparationError) {
      throw error;
    }
    throw new DeadlineReminderPreparationError(
      "INVALID_RECORD",
      "The deadline reminder could not satisfy the notification payload contract.",
    );
  }
}

const deadlineReminderDeliverySelect = {
  dedupeKey: true,
  id: true,
  notificationType: true,
  scheduledFor: true,
  status: true,
  userId: true,
  watchlist: {
    select: {
      intake: {
        select: {
          applicationWindows: {
            orderBy: { id: "asc" },
            select: {
              closesAt: true,
              id: true,
              publicStatus: true,
            },
          },
          programId: true,
        },
      },
      notificationPreference: {
        select: {
          beforeDeadlineDays: true,
        },
      },
      program: {
        select: {
          id: true,
          name: true,
          officialUrl: true,
          status: true,
          sources: {
            orderBy: { updatedAt: "desc" },
            select: { url: true },
            take: 5,
            where: { isOfficial: true },
          },
          university: {
            select: {
              name: true,
              status: true,
            },
          },
        },
      },
      trackingStatus: true,
      userId: true,
      user: {
        select: {
          pushSubscriptions: {
            select: { id: true },
            take: 1,
            where: { revokedAt: null },
          },
        },
      },
    },
  },
  watchlistId: true,
} as const satisfies Prisma.NotificationDeliverySelect;

type DeadlineReminderDeliveryRow = Prisma.NotificationDeliveryGetPayload<{
  select: typeof deadlineReminderDeliverySelect;
}>;

function toDueDeadlineReminderRecord(
  delivery: DeadlineReminderDeliveryRow,
): DueDeadlineReminderRecord {
  const preference = delivery.watchlist.notificationPreference ?? {
    beforeDeadlineDays: [...DEFAULT_DEADLINE_REMINDER_DAYS],
  };
  return {
    applicationWindows: delivery.watchlist.intake.applicationWindows,
    catalogueEligible:
      delivery.watchlist.program.status === "ACTIVE" &&
      delivery.watchlist.program.university.status === "ACTIVE",
    deadlinePreference: preference,
    dedupeKey: delivery.dedupeKey,
    deliveryId: delivery.id,
    hasActivePushSubscription: delivery.watchlist.user.pushSubscriptions.length > 0,
    intakeProgramId: delivery.watchlist.intake.programId,
    notificationType: delivery.notificationType,
    officialSourceCandidates: [
      ...delivery.watchlist.program.sources.map(({ url }) => url),
      ...(delivery.watchlist.program.officialUrl === null
        ? []
        : [delivery.watchlist.program.officialUrl]),
    ],
    programId: delivery.watchlist.program.id,
    programName: delivery.watchlist.program.name,
    scheduledFor: delivery.scheduledFor,
    status: delivery.status,
    trackingStatus: delivery.watchlist.trackingStatus,
    universityName: delivery.watchlist.program.university.name,
    userId: delivery.userId,
    watchlistId: delivery.watchlistId,
    watchlistOwnerUserId: delivery.watchlist.userId,
  };
}

export class PrismaDeadlineReminderJobRepository implements DeadlineReminderJobRepository {
  constructor(private readonly client: typeof database = database) {}

  async findDeadlineReminderRecord(deliveryId: string): Promise<DueDeadlineReminderRecord | null> {
    const delivery = await this.client.notificationDelivery.findUnique({
      select: deadlineReminderDeliverySelect,
      where: { id: deliveryId },
    });
    return delivery === null ? null : toDueDeadlineReminderRecord(delivery);
  }

  async listDueDeadlineReminderRecords(
    now: Date,
    limit: number,
  ): Promise<DueDeadlineReminderRecord[]> {
    const deliveries = await this.client.notificationDelivery.findMany({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      select: deadlineReminderDeliverySelect,
      take: limit,
      where: {
        notificationType: "APPLICATION_DEADLINE",
        scheduledFor: {
          gte: startOfUtcDay(now),
          lte: now,
        },
        status: "SCHEDULED",
      },
    });

    return deliveries.map(toDueDeadlineReminderRecord);
  }
}

export const prismaDeadlineReminderJobRepository = new PrismaDeadlineReminderJobRepository();

export async function prepareDeadlineReminderJobByDeliveryId(
  deliveryId: string,
  options: PrepareDeadlineReminderByDeliveryIdOptions = {},
): Promise<PrepareDeadlineReminderByDeliveryIdResult> {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Deadline reminder preparation requires a valid now instant.");
  }
  if (!UUID_PATTERN.test(deliveryId)) {
    return {
      code: "INVALID_RECORD",
      deliveryId,
      status: "REJECTED",
    };
  }

  const repository = options.repository ?? prismaDeadlineReminderJobRepository;
  const record = await repository.findDeadlineReminderRecord(deliveryId);
  if (record === null) {
    return { deliveryId, status: "NOT_FOUND" };
  }

  try {
    return {
      job: prepareDeadlineReminderJob(record, now),
      status: "READY",
    };
  } catch (error) {
    if (!(error instanceof DeadlineReminderPreparationError)) {
      throw error;
    }
    return {
      code: error.code,
      deliveryId,
      status: "REJECTED",
    };
  }
}

export async function prepareDueDeadlineReminderJobs(
  options: PrepareDueDeadlineReminderJobsOptions = {},
): Promise<PrepareDueDeadlineReminderJobsResult> {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Deadline reminder preparation requires a valid now instant.");
  }
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("limit must be an integer between 1 and 1000.");
  }

  const repository = options.repository ?? prismaDeadlineReminderJobRepository;
  const records = await repository.listDueDeadlineReminderRecords(now, limit);
  const result: PrepareDueDeadlineReminderJobsResult = {
    jobs: [],
    rejected: [],
  };

  for (const record of records) {
    try {
      result.jobs.push(prepareDeadlineReminderJob(record, now));
    } catch (error) {
      if (!(error instanceof DeadlineReminderPreparationError)) {
        throw error;
      }
      result.rejected.push({
        code: error.code,
        deliveryId: record.deliveryId,
      });
    }
  }

  return result;
}
