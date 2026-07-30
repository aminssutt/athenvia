import { NotificationPayloadSchema } from "@athenvia/contracts";
import { database } from "@athenvia/database";
import { z } from "zod";

import type { NotificationPayload } from "@athenvia/contracts";
import type { Prisma } from "@athenvia/database";
import type {
  ReminderDeliveryStatus,
  ReminderPublicDateStatus,
  ReminderTrackingStatus,
} from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const ISO_INSTANT_SCHEMA = z.iso.datetime({ offset: true });
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const CANCELLATION_PAGE_SIZE = 500;
const PLANNING_WATCHLIST_PAGE_SIZE = 250;
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

export type DateChangeFieldName = "opensAt" | "closesAt";
export type DateChangeKind = "MOVED" | "PUBLISHED" | "REMOVED";

export interface DateChangeWatchlistCandidate {
  createdAt: Date;
  hasActivePushSubscription: boolean;
  intakeId: string;
  intakeProgramId: string;
  notifyOnDateChange: boolean;
  programId: string;
  programStatus: string;
  trackingStatus: ReminderTrackingStatus;
  universityStatus: string;
  userId: string;
  watchlistId: string;
}

export interface ApprovedDateChangeRevision {
  canonicalValue: Date | null;
  changeStatus: string;
  conflictKey: string | null;
  entityId: string;
  entityType: string;
  fieldName: string;
  hasConflict: boolean;
  hasNewerApprovedRevision: boolean;
  hasUnresolvedConflict: boolean;
  intakeId: string | null;
  newValue: unknown;
  oldValue: unknown;
  programId: string | null;
  programName: string | null;
  publicStatus: ReminderPublicDateStatus | null;
  revisionId: string;
  reviewedAt: Date | null;
  sourceId: string | null;
  sourceIsOfficial: boolean;
  sourceProgramId: string | null;
  sourceSnapshotId: string | null;
  sourceSnapshotSourceId: string | null;
  sourceUniversityId: string | null;
  sourceUrl: string | null;
  universityId: string | null;
  universityName: string | null;
  watchlists: readonly DateChangeWatchlistCandidate[];
}

export interface ValidatedDateChange {
  fieldName: DateChangeFieldName;
  kind: DateChangeKind;
  newInstant: Date | null;
  oldInstant: Date | null;
  officialSourceHost: string;
  officialSourceUrl: string;
  publicStatus: ReminderPublicDateStatus;
}

export interface ParsedDateChangeDedupeKey {
  revisionId: string;
  watchlistId: string;
}

export interface PlannedDateChangeDelivery {
  dedupeKey: string;
  notificationType: "DATE_CHANGED";
  scheduledFor: Date;
  status: "SCHEDULED";
  userId: string;
  watchlistId: string;
}

export interface DateChangeDeliveryRecord {
  dedupeKey: string;
  deliveryId: string;
  notificationType:
    "APPLICATION_OPENING" | "APPLICATION_DEADLINE" | "DATE_CHANGED" | "SUBMISSION_APPROVED";
  revision: ApprovedDateChangeRevision | null;
  scheduledFor: Date;
  status: ReminderDeliveryStatus;
  userId: string;
  watchlist: DateChangeWatchlistCandidate;
  watchlistId: string;
}

export interface PreparedDateChangeNotificationJob {
  change: {
    fieldName: DateChangeFieldName;
    kind: DateChangeKind;
    newDate: string | null;
    oldDate: string | null;
  };
  deliveryId: string;
  jobId: string;
  officialSourceUrl: string;
  payload: NotificationPayload;
  revisionId: string;
  userId: string;
}

export type DateChangeNotificationRejectionCode =
  | "BOTH_DATES_PAST"
  | "CANONICAL_VALUE_STALE"
  | "INVALID_DEDUPE_KEY"
  | "INVALID_RECORD"
  | "MISSED_DELIVERY_WINDOW"
  | "NEWER_REVISION_EXISTS"
  | "NOT_DUE"
  | "NOT_MATERIAL"
  | "NOT_SCHEDULED"
  | "PREFERENCE_DISABLED"
  | "REVISION_CONFLICTED"
  | "REVISION_NOT_APPROVED"
  | "SOURCE_EVIDENCE_INVALID"
  | "WATCHLIST_INELIGIBLE"
  | "WRONG_NOTIFICATION_TYPE";

export class DateChangeNotificationError extends Error {
  constructor(
    readonly code: DateChangeNotificationRejectionCode,
    message: string,
  ) {
    super(message);
    this.name = "DateChangeNotificationError";
  }
}

export type DateChangePlanningRepositoryResult =
  | { status: "NOT_FOUND"; revisionId: string }
  | {
      cancelledStaleCount: number;
      code: DateChangeNotificationRejectionCode;
      revisionId: string;
      status: "IGNORED" | "REJECTED";
    }
  | {
      cancelledStaleCount: number;
      createdCount: number;
      eligibleCount: number;
      revisionId: string;
      status: "PLANNED";
    };

export interface DateChangeNotificationRepository {
  findDateChangeDeliveryRecord(deliveryId: string): Promise<DateChangeDeliveryRecord | null>;
  listDueDateChangeDeliveryRecords(now: Date, limit: number): Promise<DateChangeDeliveryRecord[]>;
  planApprovedDateChange(
    revisionId: string,
    now: Date,
  ): Promise<DateChangePlanningRepositoryResult>;
}

export interface PlanDateChangeNotificationsOptions {
  now?: Date;
  repository?: DateChangeNotificationRepository;
}

export interface PrepareDateChangeNotificationOptions {
  now?: Date;
  repository?: DateChangeNotificationRepository;
}

export interface PrepareDueDateChangeNotificationsOptions {
  limit?: number;
  now?: Date;
  repository?: DateChangeNotificationRepository;
}

export type PrepareDateChangeNotificationResult =
  | { deliveryId: string; status: "NOT_FOUND" }
  | {
      code: DateChangeNotificationRejectionCode;
      deliveryId: string;
      status: "REJECTED";
    }
  | { job: PreparedDateChangeNotificationJob; status: "READY" };

export interface PrepareDueDateChangeNotificationsResult {
  jobs: PreparedDateChangeNotificationJob[];
  rejected: Array<{
    code: DateChangeNotificationRejectionCode;
    deliveryId: string;
  }>;
}

function assertClock(now: Date): void {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "Date-change notification processing requires a valid clock.",
    );
  }
}

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
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "Date-change notification labels cannot be empty.",
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

function safeOfficialSource(value: string | null): URL | null {
  if (value === null) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname === "" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== ""
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

type ParsedRevisionDate = Readonly<{ dayKey: string; instant: Date }>;

function utcDayKey(value: Date): string {
  return `${value.getUTCFullYear().toString().padStart(4, "0")}-${(value.getUTCMonth() + 1)
    .toString()
    .padStart(2, "0")}-${value.getUTCDate().toString().padStart(2, "0")}`;
}

function parseRevisionDate(value: unknown): ParsedRevisionDate | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  if (ISO_DATE_PATTERN.test(value)) {
    const instant = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(instant.getTime()) && utcDayKey(instant) === value
      ? { dayKey: value, instant }
      : undefined;
  }
  if (!ISO_INSTANT_SCHEMA.safeParse(value).success) {
    return undefined;
  }
  const instant = new Date(value);
  return Number.isFinite(instant.getTime()) ? { dayKey: utcDayKey(instant), instant } : undefined;
}

function utcDayNumber(value: Date): number {
  return Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
}

function formatUtcDate(value: Date): string {
  const month = MONTH_NAMES[value.getUTCMonth()];
  if (month === undefined) {
    throw new DateChangeNotificationError("INVALID_RECORD", "The changed date is invalid.");
  }
  return `${month} ${value.getUTCDate()}, ${value.getUTCFullYear()}`;
}

function fieldLabel(fieldName: DateChangeFieldName): string {
  return fieldName === "opensAt" ? "application opening date" : "application deadline";
}

function isCandidateEligible(
  candidate: DateChangeWatchlistCandidate,
  revision: ApprovedDateChangeRevision,
): boolean {
  return (
    candidate.notifyOnDateChange &&
    candidate.hasActivePushSubscription &&
    candidate.trackingStatus !== "APPLIED" &&
    candidate.programStatus === "ACTIVE" &&
    candidate.universityStatus === "ACTIVE" &&
    candidate.intakeId === revision.intakeId &&
    candidate.programId === revision.programId &&
    candidate.intakeProgramId === revision.programId &&
    revision.reviewedAt !== null &&
    Number.isFinite(candidate.createdAt.getTime()) &&
    candidate.createdAt.getTime() <= revision.reviewedAt.getTime()
  );
}

function sameCanonicalValue(canonical: Date | null, proposed: ParsedRevisionDate | null): boolean {
  return canonical === null
    ? proposed === null
    : proposed !== null && utcDayKey(canonical) === proposed.dayKey;
}

function isIgnoredCode(code: DateChangeNotificationRejectionCode): boolean {
  return code === "NOT_MATERIAL" || code === "BOTH_DATES_PAST";
}

function canonicalRevisionConflictKey(entityId: string, fieldName: string): string {
  return `APPLICATION_WINDOW:${entityId}:${fieldName}`;
}

export function parseDateChangeDedupeKey(dedupeKey: string): ParsedDateChangeDedupeKey | null {
  const parts = dedupeKey.split(":");
  if (
    parts.length !== 5 ||
    parts[0] !== "athenvia" ||
    parts[1] !== "date-change" ||
    parts[2] !== "v1"
  ) {
    return null;
  }
  const watchlistId = parts[3];
  const revisionId = parts[4];
  if (
    watchlistId === undefined ||
    revisionId === undefined ||
    !UUID_PATTERN.test(watchlistId) ||
    !UUID_PATTERN.test(revisionId)
  ) {
    return null;
  }
  return { revisionId, watchlistId };
}

export function validateApprovedDateChange(
  revision: ApprovedDateChangeRevision,
  now: Date,
): ValidatedDateChange {
  assertClock(now);
  if (
    !UUID_PATTERN.test(revision.revisionId) ||
    !UUID_PATTERN.test(revision.entityId) ||
    revision.entityType !== "APPLICATION_WINDOW" ||
    (revision.fieldName !== "opensAt" && revision.fieldName !== "closesAt") ||
    revision.intakeId === null ||
    revision.programId === null ||
    revision.universityId === null ||
    revision.programName === null ||
    revision.universityName === null
  ) {
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "The revision does not identify a supported application-window field.",
    );
  }
  const canonicalConflictKey = canonicalRevisionConflictKey(revision.entityId, revision.fieldName);
  if (revision.conflictKey !== canonicalConflictKey) {
    throw new DateChangeNotificationError(
      "REVISION_CONFLICTED",
      "The revision conflict key does not match its canonical application-window field.",
    );
  }
  if (
    revision.changeStatus !== "APPROVED" ||
    revision.reviewedAt === null ||
    !Number.isFinite(revision.reviewedAt.getTime())
  ) {
    throw new DateChangeNotificationError(
      "REVISION_NOT_APPROVED",
      "The date revision has not been approved and reviewed.",
    );
  }
  if (revision.reviewedAt.getTime() > now.getTime()) {
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "The revision review timestamp cannot be later than the processing clock.",
    );
  }
  if (revision.hasConflict || revision.hasUnresolvedConflict) {
    throw new DateChangeNotificationError(
      "REVISION_CONFLICTED",
      "Conflicted date revisions cannot produce notifications.",
    );
  }
  if (revision.hasNewerApprovedRevision) {
    throw new DateChangeNotificationError(
      "NEWER_REVISION_EXISTS",
      "A newer approved revision supersedes this date change.",
    );
  }

  const source = safeOfficialSource(revision.sourceUrl);
  const sourceBelongsToCatalogue =
    revision.sourceProgramId !== null
      ? revision.sourceProgramId === revision.programId
      : revision.sourceUniversityId === revision.universityId;
  if (
    revision.sourceId === null ||
    revision.sourceSnapshotId === null ||
    revision.sourceSnapshotSourceId !== revision.sourceId ||
    !revision.sourceIsOfficial ||
    !sourceBelongsToCatalogue ||
    source === null
  ) {
    throw new DateChangeNotificationError(
      "SOURCE_EVIDENCE_INVALID",
      "The revision requires a matching snapshot from an official catalogue source.",
    );
  }

  const oldDate = parseRevisionDate(revision.oldValue);
  const newDate = parseRevisionDate(revision.newValue);
  if (oldDate === undefined || newDate === undefined) {
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "Revision values must be null, ISO dates, or RFC3339 instants with a timezone.",
    );
  }
  if (oldDate === null && newDate === null) {
    throw new DateChangeNotificationError(
      "NOT_MATERIAL",
      "The approved revision does not add, remove, or move a date.",
    );
  }
  if (!sameCanonicalValue(revision.canonicalValue, newDate)) {
    throw new DateChangeNotificationError(
      "CANONICAL_VALUE_STALE",
      "The current canonical UTC date does not match the approved new value.",
    );
  }

  let kind: DateChangeKind;
  const reviewedDay = utcDayKey(revision.reviewedAt);
  if (oldDate === null) {
    if (newDate !== null && newDate.dayKey < reviewedDay) {
      throw new DateChangeNotificationError(
        "BOTH_DATES_PAST",
        "The newly published date was already historical when the revision was reviewed.",
      );
    }
    kind = "PUBLISHED";
  } else if (newDate === null) {
    if (oldDate.dayKey < reviewedDay) {
      throw new DateChangeNotificationError(
        "BOTH_DATES_PAST",
        "The removed date was already historical when the revision was reviewed.",
      );
    }
    kind = "REMOVED";
  } else {
    if (oldDate.dayKey === newDate.dayKey) {
      throw new DateChangeNotificationError(
        "NOT_MATERIAL",
        "The approved change does not alter the displayed UTC calendar date.",
      );
    }
    if (oldDate.dayKey < reviewedDay && newDate.dayKey < reviewedDay) {
      throw new DateChangeNotificationError(
        "BOTH_DATES_PAST",
        "Both displayed UTC calendar dates were historical when the revision was reviewed.",
      );
    }
    kind = "MOVED";
  }

  const publicStatus = revision.publicStatus;
  if (publicStatus === null) {
    throw new DateChangeNotificationError(
      "CANONICAL_VALUE_STALE",
      "The current publication status is missing.",
    );
  }
  if (
    (newDate === null && publicStatus !== "NOT_PUBLISHED") ||
    (newDate !== null && publicStatus !== "CONFIRMED" && publicStatus !== "EXPECTED")
  ) {
    throw new DateChangeNotificationError(
      "CANONICAL_VALUE_STALE",
      "The current publication status does not match the approved date value.",
    );
  }

  return {
    fieldName: revision.fieldName,
    kind,
    newInstant: newDate?.instant ?? null,
    oldInstant: oldDate?.instant ?? null,
    officialSourceHost: source.hostname,
    officialSourceUrl: `${source.origin}/`,
    publicStatus,
  };
}

export function buildDateChangeDeliveryPlan(
  revision: ApprovedDateChangeRevision,
  now: Date,
): PlannedDateChangeDelivery[] {
  validateApprovedDateChange(revision, now);
  return revision.watchlists
    .filter((candidate) => isCandidateEligible(candidate, revision))
    .map((candidate) => ({
      dedupeKey: `athenvia:date-change:v1:${candidate.watchlistId}:${revision.revisionId}`,
      notificationType: "DATE_CHANGED",
      scheduledFor: new Date(now.getTime()),
      status: "SCHEDULED",
      userId: candidate.userId,
      watchlistId: candidate.watchlistId,
    }));
}

function dateChangeCopy(
  revision: ApprovedDateChangeRevision,
  change: ValidatedDateChange,
): { body: string; title: string } {
  const program = compactLabel(
    `${revision.programName ?? ""} at ${revision.universityName ?? ""}`,
    68,
  );
  const label = fieldLabel(change.fieldName);
  const sourceHost = compactLabel(change.officialSourceHost, 50);
  const expected =
    change.publicStatus === "EXPECTED" ? " This date is expected, not confirmed." : "";
  if (change.kind === "PUBLISHED" && change.newInstant !== null) {
    return {
      body: compactLabel(
        `${program} published an ${label} of ${formatUtcDate(change.newInstant)}.${expected} Official source: ${sourceHost}.`,
        240,
      ),
      title: compactLabel(
        `${change.publicStatus === "EXPECTED" ? "Expected " : ""}${label} published: ${program}`,
        120,
      ),
    };
  }
  if (change.kind === "REMOVED" && change.oldInstant !== null) {
    return {
      body: compactLabel(
        `${program} removed the ${label} of ${formatUtcDate(change.oldInstant)}. No new date is published. Official source: ${sourceHost}.`,
        240,
      ),
      title: compactLabel(`${label} removed: ${program}`, 120),
    };
  }
  if (change.oldInstant === null || change.newInstant === null) {
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "The date-change kind is inconsistent.",
    );
  }
  return {
    body: compactLabel(
      `${program} changed its ${label} from ${formatUtcDate(change.oldInstant)} to ${formatUtcDate(change.newInstant)}.${expected} Official source: ${sourceHost}.`,
      240,
    ),
    title: compactLabel(
      `${change.publicStatus === "EXPECTED" ? "Expected " : ""}${label} changed: ${program}`,
      120,
    ),
  };
}

export function prepareDateChangeNotificationJob(
  record: DateChangeDeliveryRecord,
  now: Date,
): PreparedDateChangeNotificationJob {
  assertClock(now);
  if (record.status !== "SCHEDULED") {
    throw new DateChangeNotificationError(
      "NOT_SCHEDULED",
      "Only scheduled date-change deliveries can be prepared.",
    );
  }
  if (record.notificationType !== "DATE_CHANGED") {
    throw new DateChangeNotificationError(
      "WRONG_NOTIFICATION_TYPE",
      "Only date-change deliveries are supported.",
    );
  }
  if (
    !(record.scheduledFor instanceof Date) ||
    !Number.isFinite(record.scheduledFor.getTime()) ||
    record.scheduledFor.getTime() > now.getTime()
  ) {
    throw new DateChangeNotificationError("NOT_DUE", "The date-change delivery is not due.");
  }
  if (utcDayNumber(record.scheduledFor) !== utcDayNumber(now)) {
    throw new DateChangeNotificationError(
      "MISSED_DELIVERY_WINDOW",
      "The date-change delivery missed its UTC delivery day.",
    );
  }
  const parsedKey = parseDateChangeDedupeKey(record.dedupeKey);
  if (
    parsedKey === null ||
    parsedKey.watchlistId !== record.watchlistId ||
    record.revision === null ||
    parsedKey.revisionId !== record.revision.revisionId
  ) {
    throw new DateChangeNotificationError(
      "INVALID_DEDUPE_KEY",
      "The delivery does not have a valid date-change dedupe key.",
    );
  }
  if (
    record.userId !== record.watchlist.userId ||
    record.watchlistId !== record.watchlist.watchlistId
  ) {
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "The delivery owner does not match the watchlist owner.",
    );
  }
  if (!record.watchlist.notifyOnDateChange) {
    throw new DateChangeNotificationError(
      "PREFERENCE_DISABLED",
      "Date-change notifications are no longer enabled.",
    );
  }
  if (!isCandidateEligible(record.watchlist, record.revision)) {
    throw new DateChangeNotificationError(
      "WATCHLIST_INELIGIBLE",
      "The watchlist is no longer eligible for date-change notifications.",
    );
  }

  const change = validateApprovedDateChange(record.revision, now);
  const copy = dateChangeCopy(record.revision, change);
  try {
    const payload = NotificationPayloadSchema.parse({
      body: copy.body,
      dateStatus: change.publicStatus,
      dedupeKey: record.dedupeKey,
      deepLink: `/programs/${record.watchlist.programId}`,
      programId: record.watchlist.programId,
      scheduledFor: record.scheduledFor.toISOString(),
      title: copy.title,
      type: "DATE_CHANGED",
      watchlistId: record.watchlistId,
    });
    return {
      change: {
        fieldName: change.fieldName,
        kind: change.kind,
        newDate: change.newInstant?.toISOString() ?? null,
        oldDate: change.oldInstant?.toISOString() ?? null,
      },
      deliveryId: record.deliveryId,
      jobId: record.deliveryId,
      officialSourceUrl: change.officialSourceUrl,
      payload,
      revisionId: record.revision.revisionId,
      userId: record.userId,
    };
  } catch (error) {
    if (error instanceof DateChangeNotificationError) {
      throw error;
    }
    throw new DateChangeNotificationError(
      "INVALID_RECORD",
      "The date-change notification could not satisfy the payload contract.",
    );
  }
}

const revisionSelect = {
  changeStatus: true,
  conflictKey: true,
  createdAt: true,
  entityId: true,
  entityType: true,
  fieldName: true,
  hasConflict: true,
  id: true,
  newValue: true,
  oldValue: true,
  reviewedAt: true,
  source: {
    select: {
      id: true,
      isOfficial: true,
      programId: true,
      universityId: true,
      url: true,
    },
  },
  sourceId: true,
  sourceSnapshot: { select: { id: true, sourceId: true } },
  sourceSnapshotId: true,
} as const satisfies Prisma.DataRevisionSelect;

const applicationWindowSelect = {
  closesAt: true,
  id: true,
  intake: {
    select: {
      id: true,
      program: {
        select: {
          id: true,
          name: true,
          status: true,
          university: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      },
      programId: true,
    },
  },
  intakeId: true,
  opensAt: true,
  publicStatus: true,
} as const satisfies Prisma.ApplicationWindowSelect;

type RevisionRow = Prisma.DataRevisionGetPayload<{ select: typeof revisionSelect }>;
type ApplicationWindowRow = Prisma.ApplicationWindowGetPayload<{
  select: typeof applicationWindowSelect;
}>;

async function hydrateApprovedDateChangeRevision(
  transaction: Prisma.TransactionClient,
  revisionId: string,
): Promise<ApprovedDateChangeRevision | null> {
  const revision = await transaction.dataRevision.findUnique({
    select: revisionSelect,
    where: { id: revisionId },
  });
  if (revision === null) {
    return null;
  }
  const window =
    revision.entityType === "APPLICATION_WINDOW"
      ? await transaction.applicationWindow.findUnique({
          select: applicationWindowSelect,
          where: { id: revision.entityId },
        })
      : null;
  const canonicalConflictKey = canonicalRevisionConflictKey(revision.entityId, revision.fieldName);
  const [hasUnresolvedConflict, latestApprovedRevision] = await Promise.all([
    transaction.dataRevision
      .count({
        where: {
          changeStatus: "PENDING",
          conflictKey: canonicalConflictKey,
          id: { not: revision.id },
        },
      })
      .then((count) => count > 0),
    transaction.dataRevision.findFirst({
      orderBy: [{ reviewedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
      where: {
        changeStatus: "APPROVED",
        entityId: revision.entityId,
        entityType: revision.entityType,
        fieldName: revision.fieldName,
        reviewedAt: { not: null },
      },
    }),
  ]);
  return toApprovedDateChangeRevision(
    revision,
    window,
    hasUnresolvedConflict,
    latestApprovedRevision !== null && latestApprovedRevision.id !== revision.id,
  );
}

async function cancelSupersededDateChangeDeliveries(
  transaction: Prisma.TransactionClient,
  revision: ApprovedDateChangeRevision,
): Promise<number> {
  const watchlistIds = [...new Set(revision.watchlists.map(({ watchlistId }) => watchlistId))];
  if (watchlistIds.length === 0) {
    return 0;
  }
  let afterId: string | undefined;
  let cancelledCount = 0;
  while (true) {
    const scheduled = await transaction.notificationDelivery.findMany({
      orderBy: { id: "asc" },
      select: { dedupeKey: true, id: true, watchlistId: true },
      take: CANCELLATION_PAGE_SIZE,
      where: {
        notificationType: "DATE_CHANGED",
        status: "SCHEDULED",
        watchlistId: { in: watchlistIds },
        ...(afterId === undefined ? {} : { id: { gt: afterId } }),
      },
    });
    if (scheduled.length === 0) {
      break;
    }
    const revisionIds = new Set<string>();
    const parsedByDeliveryId = new Map<string, ParsedDateChangeDedupeKey>();
    for (const delivery of scheduled) {
      const parsed = parseDateChangeDedupeKey(delivery.dedupeKey);
      if (
        parsed !== null &&
        parsed.watchlistId === delivery.watchlistId &&
        parsed.revisionId !== revision.revisionId
      ) {
        revisionIds.add(parsed.revisionId);
        parsedByDeliveryId.set(delivery.id, parsed);
      }
    }
    if (revisionIds.size > 0) {
      const supersededRevisions = await transaction.dataRevision.findMany({
        select: { entityId: true, entityType: true, fieldName: true, id: true },
        where: { id: { in: [...revisionIds] } },
      });
      const matchingRevisionIds = new Set(
        supersededRevisions
          .filter(
            (candidate) =>
              candidate.entityType === revision.entityType &&
              candidate.entityId === revision.entityId &&
              candidate.fieldName === revision.fieldName,
          )
          .map(({ id }) => id),
      );
      const deliveryIds = scheduled
        .filter((delivery) => {
          const parsed = parsedByDeliveryId.get(delivery.id);
          return parsed !== undefined && matchingRevisionIds.has(parsed.revisionId);
        })
        .map(({ id }) => id);
      if (deliveryIds.length > 0) {
        const cancelled = await transaction.notificationDelivery.updateMany({
          data: { status: "CANCELLED" },
          where: {
            id: { in: deliveryIds },
            status: "SCHEDULED",
          },
        });
        cancelledCount += cancelled.count;
      }
    }
    afterId = scheduled.at(-1)?.id;
    if (scheduled.length < CANCELLATION_PAGE_SIZE) {
      break;
    }
  }
  return cancelledCount;
}

function toApprovedDateChangeRevision(
  revision: RevisionRow,
  window: ApplicationWindowRow | null,
  hasUnresolvedConflict: boolean,
  hasNewerApprovedRevision: boolean,
): ApprovedDateChangeRevision {
  const program = window?.intake.program ?? null;
  return {
    canonicalValue:
      revision.fieldName === "opensAt"
        ? (window?.opensAt ?? null)
        : revision.fieldName === "closesAt"
          ? (window?.closesAt ?? null)
          : null,
    changeStatus: revision.changeStatus,
    conflictKey: revision.conflictKey,
    entityId: revision.entityId,
    entityType: revision.entityType,
    fieldName: revision.fieldName,
    hasConflict: revision.hasConflict,
    hasNewerApprovedRevision,
    hasUnresolvedConflict,
    intakeId: window?.intakeId ?? null,
    newValue: revision.newValue,
    oldValue: revision.oldValue,
    programId: program?.id ?? null,
    programName: program?.name ?? null,
    publicStatus: window?.publicStatus ?? null,
    revisionId: revision.id,
    reviewedAt: revision.reviewedAt,
    sourceId: revision.sourceId,
    sourceIsOfficial: revision.source?.isOfficial ?? false,
    sourceProgramId: revision.source?.programId ?? null,
    sourceSnapshotId: revision.sourceSnapshotId,
    sourceSnapshotSourceId: revision.sourceSnapshot?.sourceId ?? null,
    sourceUniversityId: revision.source?.universityId ?? null,
    sourceUrl: revision.source?.url ?? null,
    universityId: program?.university.id ?? null,
    universityName: program?.university.name ?? null,
    watchlists: [],
  };
}

const planningWatchlistSelect = {
  createdAt: true,
  id: true,
  intake: { select: { programId: true } },
  intakeId: true,
  notificationPreference: { select: { notifyOnDateChange: true } },
  program: {
    select: {
      id: true,
      status: true,
      university: { select: { status: true } },
    },
  },
  programId: true,
  trackingStatus: true,
  user: {
    select: {
      pushSubscriptions: {
        select: { id: true },
        take: 1,
        where: { revokedAt: null },
      },
    },
  },
  userId: true,
} as const satisfies Prisma.UserWatchlistSelect;

type PlanningWatchlistRow = Prisma.UserWatchlistGetPayload<{
  select: typeof planningWatchlistSelect;
}>;

function toPlanningWatchlistCandidate(
  watchlist: PlanningWatchlistRow,
): DateChangeWatchlistCandidate {
  return {
    createdAt: watchlist.createdAt,
    hasActivePushSubscription: watchlist.user.pushSubscriptions.length > 0,
    intakeId: watchlist.intakeId,
    intakeProgramId: watchlist.intake.programId,
    notifyOnDateChange: watchlist.notificationPreference?.notifyOnDateChange ?? true,
    programId: watchlist.programId,
    programStatus: watchlist.program.status,
    trackingStatus: watchlist.trackingStatus,
    universityStatus: watchlist.program.university.status,
    userId: watchlist.userId,
    watchlistId: watchlist.id,
  };
}

const dateChangeDeliverySelect = {
  dedupeKey: true,
  id: true,
  notificationType: true,
  scheduledFor: true,
  status: true,
  userId: true,
  watchlist: {
    select: {
      createdAt: true,
      id: true,
      intake: { select: { programId: true } },
      intakeId: true,
      notificationPreference: { select: { notifyOnDateChange: true } },
      program: {
        select: {
          id: true,
          status: true,
          university: { select: { status: true } },
        },
      },
      programId: true,
      trackingStatus: true,
      user: {
        select: {
          pushSubscriptions: {
            select: { id: true },
            take: 1,
            where: { revokedAt: null },
          },
        },
      },
      userId: true,
    },
  },
  watchlistId: true,
} as const satisfies Prisma.NotificationDeliverySelect;

type DateChangeDeliveryRow = Prisma.NotificationDeliveryGetPayload<{
  select: typeof dateChangeDeliverySelect;
}>;

function toDateChangeWatchlistCandidate(
  delivery: DateChangeDeliveryRow,
): DateChangeWatchlistCandidate {
  return {
    createdAt: delivery.watchlist.createdAt,
    hasActivePushSubscription: delivery.watchlist.user.pushSubscriptions.length > 0,
    intakeId: delivery.watchlist.intakeId,
    intakeProgramId: delivery.watchlist.intake.programId,
    notifyOnDateChange: delivery.watchlist.notificationPreference?.notifyOnDateChange ?? true,
    programId: delivery.watchlist.programId,
    programStatus: delivery.watchlist.program.status,
    trackingStatus: delivery.watchlist.trackingStatus,
    universityStatus: delivery.watchlist.program.university.status,
    userId: delivery.watchlist.userId,
    watchlistId: delivery.watchlist.id,
  };
}

export class PrismaDateChangeNotificationRepository implements DateChangeNotificationRepository {
  constructor(private readonly client: typeof database = database) {}

  async planApprovedDateChange(
    revisionId: string,
    now: Date,
  ): Promise<DateChangePlanningRepositoryResult> {
    return this.client.$transaction(async (transaction) => {
      const identity = await transaction.dataRevision.findUnique({
        select: { entityId: true, entityType: true, fieldName: true },
        where: { id: revisionId },
      });
      if (identity === null) {
        return { revisionId, status: "NOT_FOUND" };
      }
      const lockKey = canonicalRevisionConflictKey(identity.entityId, identity.fieldName);
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const revision = await hydrateApprovedDateChangeRevision(transaction, revisionId);
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
      let createdCount = 0;
      let eligibleCount = 0;
      const canCancelSuperseded =
        revision.changeStatus === "APPROVED" &&
        !revision.hasNewerApprovedRevision &&
        revision.entityType === "APPLICATION_WINDOW" &&
        (revision.fieldName === "opensAt" || revision.fieldName === "closesAt") &&
        revision.intakeId !== null &&
        revision.programId !== null;
      if (canCancelSuperseded) {
        let afterId: string | undefined;
        while (true) {
          const watchlists = await transaction.userWatchlist.findMany({
            orderBy: { id: "asc" },
            select: planningWatchlistSelect,
            take: PLANNING_WATCHLIST_PAGE_SIZE,
            where: {
              intakeId: revision.intakeId ?? undefined,
              ...(afterId === undefined ? {} : { id: { gt: afterId } }),
            },
          });
          if (watchlists.length === 0) {
            break;
          }
          const pageRevision: ApprovedDateChangeRevision = {
            ...revision,
            watchlists: watchlists.map(toPlanningWatchlistCandidate),
          };
          cancelledStaleCount += await cancelSupersededDateChangeDeliveries(
            transaction,
            pageRevision,
          );
          if (planningError === null) {
            const deliveries = buildDateChangeDeliveryPlan(pageRevision, now);
            eligibleCount += deliveries.length;
            if (deliveries.length > 0) {
              const created = await transaction.notificationDelivery.createMany({
                data: deliveries,
                skipDuplicates: true,
              });
              createdCount += created.count;
            }
          }
          afterId = watchlists.at(-1)?.id;
          if (watchlists.length < PLANNING_WATCHLIST_PAGE_SIZE) {
            break;
          }
        }
      }
      if (planningError !== null) {
        return {
          cancelledStaleCount,
          code: planningError.code,
          revisionId,
          status: isIgnoredCode(planningError.code) ? "IGNORED" : "REJECTED",
        };
      }
      return {
        cancelledStaleCount,
        createdCount,
        eligibleCount,
        revisionId,
        status: "PLANNED",
      };
    });
  }

  async findDateChangeDeliveryRecord(deliveryId: string): Promise<DateChangeDeliveryRecord | null> {
    return this.client.$transaction(async (transaction) => {
      const delivery = await transaction.notificationDelivery.findUnique({
        select: dateChangeDeliverySelect,
        where: { id: deliveryId },
      });
      if (delivery === null) {
        return null;
      }
      const parsedKey = parseDateChangeDedupeKey(delivery.dedupeKey);
      const revision =
        parsedKey === null
          ? null
          : await hydrateApprovedDateChangeRevision(transaction, parsedKey.revisionId);
      return {
        dedupeKey: delivery.dedupeKey,
        deliveryId: delivery.id,
        notificationType: delivery.notificationType,
        revision,
        scheduledFor: delivery.scheduledFor,
        status: delivery.status,
        userId: delivery.userId,
        watchlist: toDateChangeWatchlistCandidate(delivery),
        watchlistId: delivery.watchlistId,
      };
    });
  }

  async listDueDateChangeDeliveryRecords(
    now: Date,
    limit: number,
  ): Promise<DateChangeDeliveryRecord[]> {
    const startOfDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    return this.client.$transaction(async (transaction) => {
      const deliveries = await transaction.notificationDelivery.findMany({
        orderBy: [{ scheduledFor: "asc" }, { id: "asc" }],
        select: dateChangeDeliverySelect,
        take: limit,
        where: {
          notificationType: "DATE_CHANGED",
          scheduledFor: { gte: startOfDay, lte: now },
          status: "SCHEDULED",
        },
      });
      const revisions = new Map<string, ApprovedDateChangeRevision | null>();
      for (const delivery of deliveries) {
        const parsedKey = parseDateChangeDedupeKey(delivery.dedupeKey);
        if (parsedKey !== null && !revisions.has(parsedKey.revisionId)) {
          revisions.set(
            parsedKey.revisionId,
            await hydrateApprovedDateChangeRevision(transaction, parsedKey.revisionId),
          );
        }
      }
      return deliveries.map((delivery) => {
        const parsedKey = parseDateChangeDedupeKey(delivery.dedupeKey);
        const revision = parsedKey === null ? null : (revisions.get(parsedKey.revisionId) ?? null);
        return {
          dedupeKey: delivery.dedupeKey,
          deliveryId: delivery.id,
          notificationType: delivery.notificationType,
          revision,
          scheduledFor: delivery.scheduledFor,
          status: delivery.status,
          userId: delivery.userId,
          watchlist: toDateChangeWatchlistCandidate(delivery),
          watchlistId: delivery.watchlistId,
        };
      });
    });
  }
}

export const prismaDateChangeNotificationRepository = new PrismaDateChangeNotificationRepository();

export async function planDateChangeNotifications(
  revisionId: string,
  options: PlanDateChangeNotificationsOptions = {},
): Promise<DateChangePlanningRepositoryResult> {
  if (!UUID_PATTERN.test(revisionId)) {
    return {
      cancelledStaleCount: 0,
      code: "INVALID_RECORD",
      revisionId,
      status: "REJECTED",
    };
  }
  const now = options.now ?? new Date();
  try {
    assertClock(now);
  } catch (error) {
    if (error instanceof DateChangeNotificationError) {
      return {
        cancelledStaleCount: 0,
        code: error.code,
        revisionId,
        status: "REJECTED",
      };
    }
    throw error;
  }
  return (options.repository ?? prismaDateChangeNotificationRepository).planApprovedDateChange(
    revisionId,
    now,
  );
}

export async function prepareDateChangeNotificationJobByDeliveryId(
  deliveryId: string,
  options: PrepareDateChangeNotificationOptions = {},
): Promise<PrepareDateChangeNotificationResult> {
  if (!UUID_PATTERN.test(deliveryId)) {
    return { code: "INVALID_RECORD", deliveryId, status: "REJECTED" };
  }
  const now = options.now ?? new Date();
  try {
    assertClock(now);
  } catch (error) {
    if (error instanceof DateChangeNotificationError) {
      return { code: error.code, deliveryId, status: "REJECTED" };
    }
    throw error;
  }
  const record = await (
    options.repository ?? prismaDateChangeNotificationRepository
  ).findDateChangeDeliveryRecord(deliveryId);
  if (record === null) {
    return { deliveryId, status: "NOT_FOUND" };
  }
  try {
    return {
      job: prepareDateChangeNotificationJob(record, now),
      status: "READY",
    };
  } catch (error) {
    if (!(error instanceof DateChangeNotificationError)) {
      throw error;
    }
    return { code: error.code, deliveryId, status: "REJECTED" };
  }
}

export async function prepareDueDateChangeNotificationJobs(
  options: PrepareDueDateChangeNotificationsOptions = {},
): Promise<PrepareDueDateChangeNotificationsResult> {
  const now = options.now ?? new Date();
  assertClock(now);
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("Date-change notification batch limit must be between 1 and 1000.");
  }
  const records = await (
    options.repository ?? prismaDateChangeNotificationRepository
  ).listDueDateChangeDeliveryRecords(now, limit);
  const result: PrepareDueDateChangeNotificationsResult = { jobs: [], rejected: [] };
  for (const record of records) {
    try {
      result.jobs.push(prepareDateChangeNotificationJob(record, now));
    } catch (error) {
      if (!(error instanceof DateChangeNotificationError)) {
        throw error;
      }
      result.rejected.push({ code: error.code, deliveryId: record.deliveryId });
    }
  }
  return result;
}
