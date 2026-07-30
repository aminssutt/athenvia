import { DEFAULT_OPENING_REMINDER_DAYS, NotificationPayloadSchema } from "@athenvia/contracts";
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

export type OpeningReminderOffset = 30 | 7 | 0;

export interface DueOpeningReminderWindow {
  id: string;
  opensAt: Date | null;
  publicStatus: ReminderPublicDateStatus;
}

export interface DueOpeningReminderRecord {
  applicationWindows: readonly DueOpeningReminderWindow[];
  catalogueEligible: boolean;
  dedupeKey: string;
  deliveryId: string;
  intakeProgramId: string;
  notificationType:
    "APPLICATION_OPENING" | "APPLICATION_DEADLINE" | "DATE_CHANGED" | "SUBMISSION_APPROVED";
  officialSourceCandidates: readonly string[];
  hasActivePushSubscription: boolean;
  openingPreference: {
    beforeOpenDays: readonly number[];
    notifyOnOpen: boolean;
  };
  programId: string;
  programName: string;
  universityName: string;
  scheduledFor: Date;
  status: ReminderDeliveryStatus;
  trackingStatus: ReminderTrackingStatus;
  userId: string;
  watchlistId: string;
  watchlistOwnerUserId: string;
}

export interface ParsedOpeningReminderKey {
  offsetDays: OpeningReminderOffset;
  watchlistId: string;
  windowId: string;
}

export interface PreparedOpeningReminderJob {
  deliveryId: string;
  jobId: string;
  officialSourceUrl: string;
  payload: NotificationPayload;
  userId: string;
}

export type OpeningReminderRejectionCode =
  | "DATE_NOT_DELIVERABLE"
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

export class OpeningReminderPreparationError extends Error {
  constructor(
    readonly code: OpeningReminderRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "OpeningReminderPreparationError";
  }
}

export interface OpeningReminderJobRepository {
  findOpeningReminderRecord(deliveryId: string): Promise<DueOpeningReminderRecord | null>;
  listDueOpeningReminderRecords(now: Date, limit: number): Promise<DueOpeningReminderRecord[]>;
}

export interface PrepareDueOpeningReminderJobsOptions {
  limit?: number;
  now?: Date;
  repository?: OpeningReminderJobRepository;
}

export interface RejectedOpeningReminder {
  code: OpeningReminderRejectionCode;
  deliveryId: string;
}

export interface PrepareDueOpeningReminderJobsResult {
  jobs: PreparedOpeningReminderJob[];
  rejected: RejectedOpeningReminder[];
}

export interface PrepareOpeningReminderByDeliveryIdOptions {
  now?: Date;
  repository?: OpeningReminderJobRepository;
}

export type PrepareOpeningReminderByDeliveryIdResult =
  | {
      deliveryId: string;
      status: "NOT_FOUND";
    }
  | {
      code: OpeningReminderRejectionCode;
      deliveryId: string;
      status: "REJECTED";
    }
  | {
      job: PreparedOpeningReminderJob;
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
    throw new OpeningReminderPreparationError(
      "INVALID_RECORD",
      "Opening reminder labels cannot be empty.",
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
    throw new OpeningReminderPreparationError(
      "INVALID_RECORD",
      "The application opening date is invalid.",
    );
  }
  return `${month} ${value.getUTCDate()}, ${value.getUTCFullYear()}`;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function openingTitle(
  programLabel: string,
  dateStatus: "CONFIRMED" | "EXPECTED",
  offsetDays: OpeningReminderOffset,
): string {
  const timing = offsetDays === 0 ? "today" : `in ${offsetDays} days`;
  const prefix =
    dateStatus === "EXPECTED"
      ? `Expected application opening ${timing}`
      : `Applications open ${timing}`;
  return compactLabel(`${prefix}: ${compactLabel(programLabel, 78)}`, 120);
}

function openingBody(
  programLabel: string,
  sourceHost: string,
  opensAt: Date,
  dateStatus: "CONFIRMED" | "EXPECTED",
): string {
  // Reserve enough space for the status qualifier and source identifier so
  // neither can be truncated out of the 240-character payload body.
  const program = compactLabel(programLabel, 60);
  const source = compactLabel(sourceHost, 50);
  const date = formatUtcDate(opensAt);
  if (dateStatus === "EXPECTED") {
    return compactLabel(
      `${program} is expected to open applications on ${date}. This date is expected, not confirmed. Program source: ${source}.`,
      240,
    );
  }
  return compactLabel(
    `${program} is confirmed to open applications on ${date}. Official program source: ${source}.`,
    240,
  );
}

export function parseOpeningReminderDedupeKey(dedupeKey: string): ParsedOpeningReminderKey | null {
  const parts = dedupeKey.split(":");
  if (
    parts.length !== 7 ||
    parts[0] !== "athenvia" ||
    parts[1] !== "reminder" ||
    parts[2] !== "v1" ||
    parts[5] !== "opening"
  ) {
    return null;
  }

  const watchlistId = parts[3];
  const windowId = parts[4];
  const offsetText = parts[6];
  const offsetDays =
    offsetText === "30" ? 30 : offsetText === "7" ? 7 : offsetText === "0" ? 0 : null;
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

export function prepareOpeningReminderJob(
  record: DueOpeningReminderRecord,
  now: Date,
): PreparedOpeningReminderJob {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new OpeningReminderPreparationError(
      "INVALID_RECORD",
      "Opening reminder preparation requires a valid clock.",
    );
  }
  if (record.status !== "SCHEDULED") {
    throw new OpeningReminderPreparationError(
      "NOT_SCHEDULED",
      "Only scheduled notification deliveries can be prepared.",
    );
  }
  if (record.notificationType !== "APPLICATION_OPENING") {
    throw new OpeningReminderPreparationError(
      "WRONG_NOTIFICATION_TYPE",
      "Only application-opening deliveries are supported.",
    );
  }
  if (record.userId !== record.watchlistOwnerUserId) {
    throw new OpeningReminderPreparationError(
      "INVALID_RECORD",
      "The notification delivery owner does not match the watchlist owner.",
    );
  }
  if (record.programId !== record.intakeProgramId) {
    throw new OpeningReminderPreparationError(
      "INVALID_RECORD",
      "The watchlist program does not match its intake program.",
    );
  }
  if (
    !record.catalogueEligible ||
    record.trackingStatus === "APPLIED" ||
    !record.hasActivePushSubscription
  ) {
    throw new OpeningReminderPreparationError(
      "WATCHLIST_INELIGIBLE",
      "The watchlist is no longer eligible for opening reminders.",
    );
  }
  if (
    !(record.scheduledFor instanceof Date) ||
    !Number.isFinite(record.scheduledFor.getTime()) ||
    record.scheduledFor.getTime() > now.getTime()
  ) {
    throw new OpeningReminderPreparationError("NOT_DUE", "The opening reminder is not due.");
  }
  if (
    record.scheduledFor.getUTCFullYear() !== now.getUTCFullYear() ||
    record.scheduledFor.getUTCMonth() !== now.getUTCMonth() ||
    record.scheduledFor.getUTCDate() !== now.getUTCDate()
  ) {
    throw new OpeningReminderPreparationError(
      "MISSED_DELIVERY_WINDOW",
      "The opening reminder missed its UTC delivery day.",
    );
  }

  const parsedKey = parseOpeningReminderDedupeKey(record.dedupeKey);
  if (parsedKey === null || parsedKey.watchlistId !== record.watchlistId) {
    throw new OpeningReminderPreparationError(
      "INVALID_DEDUPE_KEY",
      "The delivery does not have a valid opening-reminder dedupe key.",
    );
  }
  const preferenceEnabled =
    parsedKey.offsetDays === 0
      ? record.openingPreference.notifyOnOpen
      : record.openingPreference.beforeOpenDays.includes(parsedKey.offsetDays);
  if (!preferenceEnabled) {
    throw new OpeningReminderPreparationError(
      "PREFERENCE_DISABLED",
      "The opening reminder offset is no longer enabled.",
    );
  }
  const window = record.applicationWindows.find(({ id }) => id === parsedKey.windowId);
  if (window === undefined) {
    throw new OpeningReminderPreparationError(
      "WINDOW_NOT_FOUND",
      "The application window referenced by the delivery no longer exists.",
    );
  }
  if (
    !(window.opensAt instanceof Date) ||
    !Number.isFinite(window.opensAt.getTime()) ||
    (window.publicStatus !== "CONFIRMED" && window.publicStatus !== "EXPECTED")
  ) {
    throw new OpeningReminderPreparationError(
      "DATE_NOT_DELIVERABLE",
      "The application opening date is not deliverable.",
    );
  }

  const expectedSchedule = UTC_STORED_INSTANT_TIME_POLICY.reminderAt(
    window.opensAt,
    parsedKey.offsetDays,
  );
  if (expectedSchedule.getTime() !== record.scheduledFor.getTime()) {
    throw new OpeningReminderPreparationError(
      "SCHEDULE_MISMATCH",
      "The delivery schedule no longer matches its application opening date.",
    );
  }

  const officialSource = safeOfficialSource(record.officialSourceCandidates);
  if (officialSource === null) {
    throw new OpeningReminderPreparationError(
      "OFFICIAL_SOURCE_MISSING",
      "A valid official source is required for an opening reminder.",
    );
  }

  try {
    const programLabel = `${record.programName} at ${record.universityName}`;
    const payload = NotificationPayloadSchema.parse({
      body: openingBody(programLabel, officialSource.hostname, window.opensAt, window.publicStatus),
      dateStatus: window.publicStatus,
      dedupeKey: record.dedupeKey,
      deepLink: `/programs/${record.programId}`,
      programId: record.programId,
      scheduledFor: record.scheduledFor.toISOString(),
      title: openingTitle(programLabel, window.publicStatus, parsedKey.offsetDays),
      type: "APPLICATION_OPENING",
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
    if (error instanceof OpeningReminderPreparationError) {
      throw error;
    }
    throw new OpeningReminderPreparationError(
      "INVALID_RECORD",
      "The opening reminder could not satisfy the notification payload contract.",
    );
  }
}

const openingReminderDeliverySelect = {
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
              id: true,
              opensAt: true,
              publicStatus: true,
            },
          },
          programId: true,
        },
      },
      notificationPreference: {
        select: {
          beforeOpenDays: true,
          notifyOnOpen: true,
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

type OpeningReminderDeliveryRow = Prisma.NotificationDeliveryGetPayload<{
  select: typeof openingReminderDeliverySelect;
}>;

function toDueOpeningReminderRecord(
  delivery: OpeningReminderDeliveryRow,
): DueOpeningReminderRecord {
  const preference = delivery.watchlist.notificationPreference ?? {
    beforeOpenDays: DEFAULT_OPENING_REMINDER_DAYS.filter((offset) => offset > 0),
    notifyOnOpen: true,
  };
  return {
    applicationWindows: delivery.watchlist.intake.applicationWindows,
    catalogueEligible:
      delivery.watchlist.program.status === "ACTIVE" &&
      delivery.watchlist.program.university.status === "ACTIVE",
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
    openingPreference: preference,
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

export class PrismaOpeningReminderJobRepository implements OpeningReminderJobRepository {
  constructor(private readonly client: typeof database = database) {}

  async findOpeningReminderRecord(deliveryId: string): Promise<DueOpeningReminderRecord | null> {
    const delivery = await this.client.notificationDelivery.findUnique({
      select: openingReminderDeliverySelect,
      where: { id: deliveryId },
    });
    return delivery === null ? null : toDueOpeningReminderRecord(delivery);
  }

  async listDueOpeningReminderRecords(
    now: Date,
    limit: number,
  ): Promise<DueOpeningReminderRecord[]> {
    const deliveries = await this.client.notificationDelivery.findMany({
      orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
      select: openingReminderDeliverySelect,
      take: limit,
      where: {
        notificationType: "APPLICATION_OPENING",
        scheduledFor: {
          gte: startOfUtcDay(now),
          lte: now,
        },
        status: "SCHEDULED",
      },
    });

    return deliveries.map(toDueOpeningReminderRecord);
  }
}

export const prismaOpeningReminderJobRepository = new PrismaOpeningReminderJobRepository();

export async function prepareOpeningReminderJobByDeliveryId(
  deliveryId: string,
  options: PrepareOpeningReminderByDeliveryIdOptions = {},
): Promise<PrepareOpeningReminderByDeliveryIdResult> {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Opening reminder preparation requires a valid now instant.");
  }
  if (!UUID_PATTERN.test(deliveryId)) {
    return {
      code: "INVALID_RECORD",
      deliveryId,
      status: "REJECTED",
    };
  }

  const repository = options.repository ?? prismaOpeningReminderJobRepository;
  const record = await repository.findOpeningReminderRecord(deliveryId);
  if (record === null) {
    return { deliveryId, status: "NOT_FOUND" };
  }

  try {
    return {
      job: prepareOpeningReminderJob(record, now),
      status: "READY",
    };
  } catch (error) {
    if (!(error instanceof OpeningReminderPreparationError)) {
      throw error;
    }
    return {
      code: error.code,
      deliveryId,
      status: "REJECTED",
    };
  }
}

export async function prepareDueOpeningReminderJobs(
  options: PrepareDueOpeningReminderJobsOptions = {},
): Promise<PrepareDueOpeningReminderJobsResult> {
  const now = options.now ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Opening reminder preparation requires a valid now instant.");
  }
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("limit must be an integer between 1 and 1000.");
  }

  const repository = options.repository ?? prismaOpeningReminderJobRepository;
  const records = await repository.listDueOpeningReminderRecords(now, limit);
  const result: PrepareDueOpeningReminderJobsResult = {
    jobs: [],
    rejected: [],
  };

  for (const record of records) {
    try {
      result.jobs.push(prepareOpeningReminderJob(record, now));
    } catch (error) {
      if (!(error instanceof OpeningReminderPreparationError)) {
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
