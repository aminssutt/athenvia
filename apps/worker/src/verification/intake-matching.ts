import type { DateCandidate } from "../parsing";

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/u;

export type MatchableApplicationRound = Readonly<{
  id: string;
  roundName: string | null;
}>;

export type MatchableIntake = Readonly<{
  applicationRounds: readonly MatchableApplicationRound[];
  id: string;
  month: number | null;
  startDate: string | null;
  year: number;
}>;

export type IntakeHint = Readonly<{
  month?: number;
  year: number;
}>;

export type IntakeDateEvidence = Readonly<{
  candidate: DateCandidate;
  evidenceId: string;
  intakeHint?: IntakeHint;
  roundNameHint?: string | null;
}>;

export type IntakeMatchReason =
  | "AMBIGUOUS_INTAKE"
  | "AMBIGUOUS_ROUND"
  | "CANDIDATE_REQUIRES_REVIEW"
  | "CONFLICTING_INTAKE_HINT"
  | "NO_ELIGIBLE_INTAKE"
  | "OLD_INTAKE"
  | "STALE_CANDIDATE";

export type IntakeDateMatch = Readonly<{
  applicationRoundId: string | null;
  evidenceId: string;
  intakeId: string | null;
  reasons: readonly IntakeMatchReason[];
  roundKey: string | null;
  roundName: string | null;
  status: "MATCHED" | "REJECTED" | "REVIEW";
}>;

export type IntakeMatchingOptions = Readonly<{
  asOfDate: string;
}>;

type DateParts = {
  month: number | null;
  year: number;
};

function parseIsoDate(
  value: string,
  field: string,
): { day: number | null; month: number; year: number } {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) {
    throw new TypeError(`${field} must be an ISO local date.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : null;
  const calendarDate = new Date(Date.UTC(year, month - 1, day ?? 1));
  if (
    year < 2000 ||
    year > 2100 ||
    month < 1 ||
    month > 12 ||
    (day !== null &&
      (day < 1 ||
        calendarDate.getUTCFullYear() !== year ||
        calendarDate.getUTCMonth() !== month - 1 ||
        calendarDate.getUTCDate() !== day))
  ) {
    throw new RangeError(`${field} must be a valid supported ISO local date.`);
  }
  return { day, month, year };
}

function normalizeRoundName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/&/gu, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function intakeMonth(intake: MatchableIntake): number | null {
  if (intake.startDate) {
    return parseIsoDate(intake.startDate, `startDate for intake ${intake.id}`).month;
  }
  return intake.month;
}

function intakeYear(intake: MatchableIntake): number {
  if (intake.startDate) {
    return parseIsoDate(intake.startDate, `startDate for intake ${intake.id}`).year;
  }
  return intake.year;
}

function isOldIntake(intake: MatchableIntake, asOf: DateParts): boolean {
  const year = intakeYear(intake);
  const month = intakeMonth(intake);
  if (year !== asOf.year) {
    return year < asOf.year;
  }
  return month !== null && asOf.month !== null && month < asOf.month;
}

function candidateDateParts(candidate: DateCandidate): DateParts[] {
  const values = candidate.localDate ? [candidate.localDate] : [...candidate.alternatives];
  const parts: DateParts[] = [];
  for (const value of values) {
    const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/u.exec(value);
    if (match) {
      parts.push({ month: Number(match[2]), year: Number(match[1]) });
      continue;
    }
    const partial = /^(\d{4})-(?:SPRING|SUMMER|AUTUMN|FALL|WINTER)$/u.exec(value);
    if (partial) {
      parts.push({ month: null, year: Number(partial[1]) });
    }
  }
  return parts;
}

function isStaleCandidate(
  candidate: DateCandidate,
  asOf: { day: number; month: number; year: number },
): boolean {
  const values = candidate.localDate ? [candidate.localDate] : [...candidate.alternatives];
  let comparable = false;
  for (const value of values) {
    const exact = ISO_DATE_PATTERN.exec(value);
    const seasonal = exact ? null : /^(\d{4})-(?:SPRING|SUMMER|AUTUMN|FALL|WINTER)$/u.exec(value);
    if (!exact && !seasonal) {
      continue;
    }
    comparable = true;
    const year = Number((exact ?? seasonal)![1]);
    if (year > asOf.year) {
      return false;
    }
    if (year === asOf.year) {
      if (!exact) {
        // A season within the as-of year is not provably in the past.
        return false;
      }
      const month = Number(exact[2]);
      const day = exact[3] ? Number(exact[3]) : null;
      if (month > asOf.month || (month === asOf.month && (day === null || day >= asOf.day))) {
        return false;
      }
    }
  }
  return comparable;
}

function matchesHint(intake: MatchableIntake, hint: IntakeHint): boolean {
  return (
    intakeYear(intake) === hint.year &&
    (hint.month === undefined || intakeMonth(intake) === hint.month)
  );
}

function derivedIntakeHint(evidence: IntakeDateEvidence): {
  conflicting: boolean;
  hint: IntakeHint | null;
} {
  const parts = candidateDateParts(evidence.candidate);
  if (evidence.candidate.kind !== "INTAKE_START") {
    return { conflicting: false, hint: evidence.intakeHint ?? null };
  }

  const years = [...new Set(parts.map(({ year }) => year))];
  const months = [...new Set(parts.map(({ month }) => month).filter((month) => month !== null))];
  const derived =
    years.length === 1
      ? {
          year: years[0]!,
          ...(months.length === 1 ? { month: months[0]! } : {}),
        }
      : null;
  const supplied = evidence.intakeHint;
  if (!supplied || !derived) {
    return { conflicting: false, hint: supplied ?? derived };
  }
  const conflicting =
    supplied.year !== derived.year ||
    (supplied.month !== undefined &&
      derived.month !== undefined &&
      supplied.month !== derived.month);
  return {
    conflicting,
    hint: conflicting
      ? null
      : {
          month: supplied.month ?? derived.month,
          year: supplied.year,
        },
  };
}

function isChronologicallyEligible(intake: MatchableIntake, candidate: DateCandidate): boolean {
  const parts = candidateDateParts(candidate);
  if (parts.length === 0) {
    return true;
  }
  const year = intakeYear(intake);
  const month = intakeMonth(intake);
  return parts.some(
    (part) =>
      year > part.year ||
      (year === part.year && (month === null || part.month === null || month >= part.month)),
  );
}

function resolveRound(
  intake: MatchableIntake,
  evidence: IntakeDateEvidence,
): {
  applicationRoundId: string | null;
  reason: "AMBIGUOUS_ROUND" | null;
  roundKey: string | null;
  roundName: string | null;
} {
  if (evidence.candidate.kind === "INTAKE_START") {
    return {
      applicationRoundId: null,
      reason: null,
      roundKey: null,
      roundName: null,
    };
  }

  const hint = evidence.roundNameHint?.trim() || null;
  if (hint) {
    const roundKey = normalizeRoundName(hint);
    const matches = intake.applicationRounds.filter(
      ({ roundName }) => roundName !== null && normalizeRoundName(roundName) === roundKey,
    );
    if (matches.length === 1) {
      return {
        applicationRoundId: matches[0]!.id,
        reason: null,
        roundKey,
        roundName: matches[0]!.roundName,
      };
    }
    return {
      applicationRoundId: null,
      reason: matches.length > 1 ? "AMBIGUOUS_ROUND" : null,
      roundKey,
      roundName: hint,
    };
  }

  if (intake.applicationRounds.length === 1) {
    const round = intake.applicationRounds[0]!;
    return {
      applicationRoundId: round.id,
      reason: null,
      roundKey: round.roundName ? normalizeRoundName(round.roundName) : "default",
      roundName: round.roundName,
    };
  }
  return {
    applicationRoundId: null,
    reason: intake.applicationRounds.length > 1 ? "AMBIGUOUS_ROUND" : null,
    roundKey: "default",
    roundName: null,
  };
}

function assertInputs(
  evidence: readonly IntakeDateEvidence[],
  intakes: readonly MatchableIntake[],
): void {
  const evidenceIds = new Set<string>();
  for (const item of evidence) {
    if (!item.evidenceId.trim() || evidenceIds.has(item.evidenceId)) {
      throw new TypeError("Every evidenceId must be non-empty and unique.");
    }
    evidenceIds.add(item.evidenceId);
    if (
      item.intakeHint &&
      (item.intakeHint.year < 2000 ||
        item.intakeHint.year > 2100 ||
        (item.intakeHint.month !== undefined &&
          (item.intakeHint.month < 1 || item.intakeHint.month > 12)))
    ) {
      throw new RangeError("Intake hints must use a supported year and month.");
    }
  }

  const intakeIds = new Set<string>();
  const applicationRoundIds = new Set<string>();
  for (const intake of intakes) {
    if (
      !intake.id.trim() ||
      intakeIds.has(intake.id) ||
      intake.year < 2000 ||
      intake.year > 2100 ||
      (intake.month !== null && (intake.month < 1 || intake.month > 12))
    ) {
      throw new TypeError("Intakes must have unique IDs and supported year/month values.");
    }
    intakeIds.add(intake.id);
    if (intake.startDate) {
      const start = parseIsoDate(intake.startDate, `startDate for intake ${intake.id}`);
      if (
        start.day === null ||
        start.year !== intake.year ||
        (intake.month !== null && start.month !== intake.month)
      ) {
        throw new TypeError("Intake startDate must agree with its year and optional month.");
      }
    }
    for (const round of intake.applicationRounds) {
      if (!round.id.trim() || applicationRoundIds.has(round.id)) {
        throw new TypeError("Application rounds must have non-empty, globally unique IDs.");
      }
      applicationRoundIds.add(round.id);
    }
  }
}

function result(
  evidenceId: string,
  status: IntakeDateMatch["status"],
  reasons: IntakeMatchReason[],
  intakeId: string | null = null,
  round: ReturnType<typeof resolveRound> | null = null,
): IntakeDateMatch {
  return Object.freeze({
    applicationRoundId: round?.applicationRoundId ?? null,
    evidenceId,
    intakeId,
    reasons: Object.freeze([...new Set(reasons)].sort()),
    roundKey: round?.roundKey ?? null,
    roundName: round?.roundName ?? null,
    status,
  });
}

export function matchDateCandidatesToIntakes(
  evidence: readonly IntakeDateEvidence[],
  intakes: readonly MatchableIntake[],
  options: IntakeMatchingOptions,
): IntakeDateMatch[] {
  const asOf = parseIsoDate(options.asOfDate, "asOfDate");
  if (asOf.day === null) {
    throw new TypeError("asOfDate must include a calendar day.");
  }
  const asOfDay = { day: asOf.day, month: asOf.month, year: asOf.year };
  assertInputs(evidence, intakes);
  const stableIntakes = [...intakes].sort((left, right) =>
    left.id < right.id ? -1 : Number(left.id > right.id),
  );

  return evidence.map((item) => {
    const reasons: IntakeMatchReason[] = [];
    if (!item.candidate.automaticPublication) {
      reasons.push("CANDIDATE_REQUIRES_REVIEW");
    }

    const derived = derivedIntakeHint(item);
    if (derived.conflicting) {
      return result(item.evidenceId, "REVIEW", [...reasons, "CONFLICTING_INTAKE_HINT"]);
    }

    // A candidate whose every date already lies before asOfDate and that carries no
    // intake hint (explicit or derived) must never re-bind to a current intake: the
    // stale value most likely belongs to a past cycle, so a human has to decide.
    if (!derived.hint && isStaleCandidate(item.candidate, asOfDay)) {
      return result(item.evidenceId, "REVIEW", [...reasons, "STALE_CANDIDATE"]);
    }

    const matching = derived.hint
      ? stableIntakes.filter((intake) => matchesHint(intake, derived.hint!))
      : stableIntakes.filter((intake) => isChronologicallyEligible(intake, item.candidate));
    const current = matching.filter((intake) => !isOldIntake(intake, asOf));
    if (matching.length > 0 && current.length === 0) {
      return result(item.evidenceId, "REJECTED", ["OLD_INTAKE"]);
    }
    if (current.length === 0) {
      return result(item.evidenceId, "REVIEW", [...reasons, "NO_ELIGIBLE_INTAKE"]);
    }
    if (current.length > 1) {
      return result(item.evidenceId, "REVIEW", [...reasons, "AMBIGUOUS_INTAKE"]);
    }

    const intake = current[0]!;
    const round = resolveRound(intake, item);
    if (round.reason) {
      reasons.push(round.reason);
    }
    return result(
      item.evidenceId,
      reasons.length === 0 ? "MATCHED" : "REVIEW",
      reasons,
      intake.id,
      round,
    );
  });
}
