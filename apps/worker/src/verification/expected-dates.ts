export type ExpectedDateField = "APPLICATION_DEADLINE" | "APPLICATION_OPEN" | "INTAKE_START";

export type HistoricalDateEvidence = Readonly<{
  evidenceId: string;
  field: ExpectedDateField;
  intakeYear: number;
  observedDate: string;
  officialSource: boolean;
  roundKey: string | null;
  sourceSnapshotId: string;
}>;

export type ExpectedDateTarget = Readonly<{
  field: ExpectedDateField;
  intakeYear: number;
  roundKey: string | null;
}>;

export type ExpectedDateEstimate = Readonly<{
  localDate: string;
  precision: "MONTH" | "SEASON";
  publicStatus: "EXPECTED";
  verificationStatus: "EXPECTED";
  wording: Readonly<{
    description: string;
    title: "Expected date";
  }>;
}>;

export type ExpectedDateReason = "CONFLICTING_HISTORY" | "INSUFFICIENT_OFFICIAL_HISTORY";

export type ExpectedDateDecision = Readonly<{
  estimate: ExpectedDateEstimate | null;
  evidence: readonly HistoricalDateEvidence[];
  ignoredEvidenceIds: readonly string[];
  publicStatus: "EXPECTED" | "NOT_PUBLISHED";
  reasons: readonly ExpectedDateReason[];
  target: ExpectedDateTarget;
  wording: Readonly<{
    description: string;
    title: "Expected date" | "Not published yet";
  }>;
}>;

type ParsedObservation = {
  calendarYear: number;
  month: number | null;
  season: "AUTUMN" | "SPRING" | "SUMMER" | "WINTER";
};

type CyclePattern = {
  intakeYear: number;
  month: number | null;
  offset: number;
  season: ParsedObservation["season"];
};

const EXPECTED_WORDING = Object.freeze({
  description:
    "Based on prior official cycles. The university has not published the official date yet.",
  title: "Expected date" as const,
});
const NOT_PUBLISHED_WORDING = Object.freeze({
  description: "There is not enough consistent official history to estimate this date.",
  title: "Not published yet" as const,
});

function seasonForMonth(month: number): ParsedObservation["season"] {
  if (month >= 3 && month <= 5) {
    return "SPRING";
  }
  if (month >= 6 && month <= 8) {
    return "SUMMER";
  }
  if (month >= 9 && month <= 11) {
    return "AUTUMN";
  }
  return "WINTER";
}

function parseObservation(value: string): ParsedObservation {
  const date = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u.exec(value);
  if (date) {
    const calendarYear = Number(date[1]);
    const month = Number(date[2]);
    const day = date[3] ? Number(date[3]) : 1;
    const parsed = new Date(Date.UTC(calendarYear, month - 1, day));
    if (
      calendarYear >= 2000 &&
      calendarYear <= 2100 &&
      month >= 1 &&
      month <= 12 &&
      day >= 1 &&
      parsed.getUTCFullYear() === calendarYear &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    ) {
      return {
        calendarYear,
        month,
        season: seasonForMonth(month),
      };
    }
  }

  const season = /^(\d{4})-(SPRING|SUMMER|AUTUMN|FALL|WINTER)$/u.exec(value);
  if (season) {
    const calendarYear = Number(season[1]);
    if (calendarYear >= 2000 && calendarYear <= 2100) {
      return {
        calendarYear,
        month: null,
        season: season[2] === "FALL" ? "AUTUMN" : (season[2] as ParsedObservation["season"]),
      };
    }
  }
  throw new TypeError("Historical observedDate must be a valid date, month, or season.");
}

function validateInputs(
  history: readonly HistoricalDateEvidence[],
  target: ExpectedDateTarget,
): void {
  if (target.intakeYear < 2000 || target.intakeYear > 2100) {
    throw new RangeError("Target intakeYear is outside the supported range.");
  }
  const evidenceIds = new Set<string>();
  for (const item of history) {
    if (
      !item.evidenceId.trim() ||
      evidenceIds.has(item.evidenceId) ||
      !item.sourceSnapshotId.trim()
    ) {
      throw new TypeError(
        "Historical evidence requires unique IDs and an immutable source snapshot ID.",
      );
    }
    evidenceIds.add(item.evidenceId);
    if (item.intakeYear < 2000 || item.intakeYear > 2100) {
      throw new RangeError("Historical intakeYear is outside the supported range.");
    }
    parseObservation(item.observedDate);
  }
}

function sameTarget(item: HistoricalDateEvidence, target: ExpectedDateTarget): boolean {
  return (
    item.field === target.field &&
    item.roundKey === target.roundKey &&
    item.intakeYear < target.intakeYear &&
    item.officialSource
  );
}

function cyclePattern(
  intakeYear: number,
  evidence: readonly HistoricalDateEvidence[],
): CyclePattern | null {
  const observations = evidence.map(({ observedDate }) => parseObservation(observedDate));
  const offsets = [...new Set(observations.map(({ calendarYear }) => calendarYear - intakeYear))];
  const seasons = [...new Set(observations.map(({ season }) => season))];
  if (offsets.length !== 1 || seasons.length !== 1) {
    return null;
  }
  const months = [...new Set(observations.map(({ month }) => month))];
  return {
    intakeYear,
    month: months.length === 1 ? months[0]! : null,
    offset: offsets[0]!,
    season: seasons[0]!,
  };
}

function noEstimate(
  history: readonly HistoricalDateEvidence[],
  ignoredEvidenceIds: readonly string[],
  target: ExpectedDateTarget,
  reason: ExpectedDateReason,
): ExpectedDateDecision {
  return Object.freeze({
    estimate: null,
    evidence: Object.freeze([...history]),
    ignoredEvidenceIds: Object.freeze([...ignoredEvidenceIds]),
    publicStatus: "NOT_PUBLISHED",
    reasons: Object.freeze([reason]),
    target: Object.freeze({ ...target }),
    wording: NOT_PUBLISHED_WORDING,
  });
}

export function generateConservativeExpectedDate(
  history: readonly HistoricalDateEvidence[],
  target: ExpectedDateTarget,
): ExpectedDateDecision {
  validateInputs(history, target);
  const ordered = [...history].sort(
    (left, right) =>
      left.intakeYear - right.intakeYear ||
      (left.evidenceId < right.evidenceId ? -1 : Number(left.evidenceId > right.evidenceId)),
  );
  const eligible = ordered.filter((item) => sameTarget(item, target));
  const eligibleIds = new Set(eligible.map(({ evidenceId }) => evidenceId));
  const ignoredEvidenceIds = ordered
    .filter(({ evidenceId }) => !eligibleIds.has(evidenceId))
    .map(({ evidenceId }) => evidenceId);

  const byCycle = new Map<number, HistoricalDateEvidence[]>();
  for (const item of eligible) {
    const cycle = byCycle.get(item.intakeYear) ?? [];
    cycle.push(item);
    byCycle.set(item.intakeYear, cycle);
  }
  if (byCycle.size < 2) {
    return noEstimate(eligible, ignoredEvidenceIds, target, "INSUFFICIENT_OFFICIAL_HISTORY");
  }

  const patterns = [...byCycle.entries()]
    .sort(([left], [right]) => left - right)
    .map(([intakeYear, evidence]) => cyclePattern(intakeYear, evidence));
  if (patterns.some((pattern) => pattern === null)) {
    return noEstimate(eligible, ignoredEvidenceIds, target, "CONFLICTING_HISTORY");
  }
  const stablePatterns = patterns as CyclePattern[];
  const offsets = [...new Set(stablePatterns.map(({ offset }) => offset))];
  const seasons = [...new Set(stablePatterns.map(({ season }) => season))];
  if (offsets.length !== 1 || seasons.length !== 1) {
    return noEstimate(eligible, ignoredEvidenceIds, target, "CONFLICTING_HISTORY");
  }

  const months = [...new Set(stablePatterns.map(({ month }) => month))];
  const estimateYear = target.intakeYear + offsets[0]!;
  if (estimateYear < 2000 || estimateYear > 2100) {
    return noEstimate(eligible, ignoredEvidenceIds, target, "CONFLICTING_HISTORY");
  }
  const precision = months.length === 1 && months[0] !== null ? "MONTH" : "SEASON";
  const localDate =
    precision === "MONTH"
      ? `${estimateYear}-${String(months[0]).padStart(2, "0")}`
      : `${estimateYear}-${seasons[0]}`;
  const estimate = Object.freeze({
    localDate,
    precision,
    publicStatus: "EXPECTED" as const,
    verificationStatus: "EXPECTED" as const,
    wording: EXPECTED_WORDING,
  });
  return Object.freeze({
    estimate,
    evidence: Object.freeze([...eligible]),
    ignoredEvidenceIds: Object.freeze(ignoredEvidenceIds),
    publicStatus: "EXPECTED",
    reasons: Object.freeze([]),
    target: Object.freeze({ ...target }),
    wording: EXPECTED_WORDING,
  });
}
