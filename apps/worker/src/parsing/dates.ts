const MONTHS = new Map<string, number>([
  ["jan", 1],
  ["january", 1],
  ["feb", 2],
  ["february", 2],
  ["mar", 3],
  ["march", 3],
  ["apr", 4],
  ["april", 4],
  ["may", 5],
  ["jun", 6],
  ["june", 6],
  ["jul", 7],
  ["july", 7],
  ["aug", 8],
  ["august", 8],
  ["sep", 9],
  ["sept", 9],
  ["september", 9],
  ["oct", 10],
  ["october", 10],
  ["nov", 11],
  ["november", 11],
  ["dec", 12],
  ["december", 12],
]);
const MONTH_PATTERN =
  "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
const MAXIMUM_TEXT_CHARACTERS = 1_000_000;
const MAXIMUM_CANDIDATES = 1_000;

export type DateCandidateKind =
  "APPLICATION_DEADLINE" | "APPLICATION_OPEN" | "INTAKE_START" | "UNKNOWN";

export type DateCandidatePrecision = "DATE" | "DATE_TIME" | "MONTH" | "SEASON";

export type DateReviewReason =
  | "AMBIGUOUS_NUMERIC_ORDER"
  | "CONFLICTING_CONTEXT"
  | "INFERRED_YEAR"
  | "INVALID_DATE"
  | "MISSING_CONTEXT"
  | "PARTIAL_DATE"
  | "TIMEZONE_ABBREVIATION";

export type DateCandidate = Readonly<{
  alternatives: readonly string[];
  automaticPublication: boolean;
  end: number;
  kind: DateCandidateKind;
  localDate: string | null;
  localTime: string | null;
  precision: DateCandidatePrecision;
  reviewReasons: readonly DateReviewReason[];
  sourceText: string;
  start: number;
  timeZone: string;
  timeZoneSource: "configured" | "document";
}>;

export type DateCandidateOptions = {
  numericDateOrder?: "DMY" | "MDY";
  referenceDate?: Date;
  timeZone: string;
};

type RawDate = {
  alternatives?: string[];
  day?: number;
  end: number;
  inferredYear?: boolean;
  invalid?: boolean;
  month?: number;
  precision: DateCandidatePrecision;
  season?: string;
  start: number;
  year?: number;
};

type ContextMatch = {
  distance: number;
  end: number;
  kind: Exclude<DateCandidateKind, "UNKNOWN">;
  start: number;
};

function canonicalTimeZone(value: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    throw new RangeError("timeZone must be a valid IANA time zone.");
  }
}

function monthNumber(value: string): number {
  return MONTHS.get(value.toLowerCase().replace(/\.$/u, "")) ?? 0;
}

function dateString(year: number, month: number, day: number): string | null {
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthString(year: number, month: number): string | null {
  return year >= 2000 && year <= 2100 && month >= 1 && month <= 12
    ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`
    : null;
}

function overlapsClaim(start: number, end: number, claims: Array<[number, number]>): boolean {
  return claims.some(([claimedStart, claimedEnd]) => start < claimedEnd && end > claimedStart);
}

function collectMatches(
  text: string,
  pattern: RegExp,
  claims: Array<[number, number]>,
  build: (match: RegExpExecArray, start: number, end: number) => RawDate | null,
): RawDate[] {
  const dates: RawDate[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    if (overlapsClaim(start, end, claims)) {
      continue;
    }
    const date = build(match, start, end);
    if (date) {
      dates.push(date);
      claims.push([start, end]);
    }
    if (dates.length + claims.length > MAXIMUM_CANDIDATES * 2) {
      throw new RangeError("Date candidate count exceeded its safety limit.");
    }
  }
  return dates;
}

function contextKind(
  text: string,
  start: number,
  end: number,
): { conflicting: boolean; kind: DateCandidateKind } {
  const windowStart = Math.max(0, start - 120);
  const windowEnd = Math.min(text.length, end + 120);
  const window = text.slice(windowStart, windowEnd).toLowerCase();
  const patterns: Array<[Exclude<DateCandidateKind, "UNKNOWN">, RegExp]> = [
    [
      "APPLICATION_DEADLINE",
      /\b(?:application deadline|deadline|closes?|closing|due|apply by|received by|submit by)\b/gu,
    ],
    ["APPLICATION_OPEN", /\b(?:applications? open|portal opens?|opening date|opens?)\b/gu],
    ["INTAKE_START", /\b(?:intake starts?|classes begin|programme starts?|program starts?)\b/gu],
  ];
  const matches: ContextMatch[] = [];
  for (const [kind, pattern] of patterns) {
    for (const match of window.matchAll(pattern)) {
      const absoluteStart = windowStart + (match.index ?? 0);
      const absoluteEnd = absoluteStart + match[0].length;
      const distance =
        absoluteEnd <= start ? start - absoluteEnd : absoluteStart >= end ? absoluteStart - end : 0;
      matches.push({ distance, end: absoluteEnd, kind, start: absoluteStart });
    }
  }
  matches.sort(
    (left, right) =>
      left.distance - right.distance ||
      (left.kind < right.kind ? -1 : Number(left.kind > right.kind)),
  );
  const nearest = matches[0];
  if (!nearest) {
    return { conflicting: false, kind: "UNKNOWN" };
  }
  const conflicting = matches.some((match) => {
    if (match.kind === nearest.kind) {
      return false;
    }
    if (Math.abs(match.distance - nearest.distance) <= 3) {
      return true;
    }

    const bothBefore = match.end <= start && nearest.end <= start;
    const bothAfter = match.start >= end && nearest.start >= end;
    if (!bothBefore && !bothAfter) {
      return false;
    }

    const left = match.start < nearest.start ? match : nearest;
    const right = left === match ? nearest : match;
    return /^\s*(?:and|or|\/|&)\s*$/iu.test(text.slice(left.end, right.start));
  });
  return { conflicting, kind: conflicting ? "UNKNOWN" : nearest.kind };
}

function timeDetails(
  text: string,
  end: number,
  configuredTimeZone: string,
): {
  end: number;
  localTime: string | null;
  reviewReason: DateReviewReason | null;
  timeZone: string;
  timeZoneSource: "configured" | "document";
} {
  const tail = text.slice(end, Math.min(text.length, end + 80));
  const match =
    /^\s*(?:,?\s*(?:at|by)\s+|,\s+)(\d{1,2})(?::(\d{2}))\s*(a\.?m\.?|p\.?m\.?)?\s*(UTC|GMT|ET|EST|EDT|PT|PST|PDT|[A-Za-z]+\/[A-Za-z_+-]+)?/iu.exec(
      tail,
    );
  if (!match) {
    return {
      end,
      localTime: null,
      reviewReason: null,
      timeZone: configuredTimeZone,
      timeZoneSource: "configured",
    };
  }

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toLowerCase().replaceAll(".", "");
  if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23)) {
    return {
      end: end + match[0].length,
      localTime: null,
      reviewReason: "INVALID_DATE",
      timeZone: configuredTimeZone,
      timeZoneSource: "configured",
    };
  }
  if (meridiem === "pm" && hour !== 12) {
    hour += 12;
  } else if (meridiem === "am" && hour === 12) {
    hour = 0;
  }

  const zoneLabel = match[4];
  if (!zoneLabel) {
    return {
      end: end + match[0].length,
      localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      reviewReason: null,
      timeZone: configuredTimeZone,
      timeZoneSource: "configured",
    };
  }
  if (/^(?:UTC|GMT)$/iu.test(zoneLabel)) {
    return {
      end: end + match[0].length,
      localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      reviewReason: null,
      timeZone: "UTC",
      timeZoneSource: "document",
    };
  }
  if (zoneLabel.includes("/")) {
    try {
      return {
        end: end + match[0].length,
        localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        reviewReason: null,
        timeZone: canonicalTimeZone(zoneLabel),
        timeZoneSource: "document",
      };
    } catch {
      return {
        end: end + match[0].length,
        localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        reviewReason: "TIMEZONE_ABBREVIATION",
        timeZone: configuredTimeZone,
        timeZoneSource: "configured",
      };
    }
  }
  return {
    end: end + match[0].length,
    localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    reviewReason: "TIMEZONE_ABBREVIATION",
    timeZone: configuredTimeZone,
    timeZoneSource: "configured",
  };
}

export function extractDateCandidates(
  text: string,
  options: DateCandidateOptions,
): DateCandidate[] {
  if (text.length > MAXIMUM_TEXT_CHARACTERS) {
    throw new RangeError("Date source text exceeded its safety limit.");
  }
  const configuredTimeZone = canonicalTimeZone(options.timeZone);
  const referenceDate = options.referenceDate ?? new Date();
  if (Number.isNaN(referenceDate.valueOf())) {
    throw new TypeError("referenceDate must be valid.");
  }
  const claims: Array<[number, number]> = [];
  const rawDates: RawDate[] = [];

  rawDates.push(
    ...collectMatches(
      text,
      /\b(20\d{2}|2100)-(\d{2})-(\d{2})\b/gu,
      claims,
      (match, start, end) => ({
        day: Number(match[3]),
        end,
        month: Number(match[2]),
        precision: "DATE",
        start,
        year: Number(match[1]),
      }),
    ),
  );
  rawDates.push(
    ...collectMatches(
      text,
      new RegExp(
        `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_PATTERN})\\.?[,]?\\s+(20\\d{2}|2100)\\b`,
        "giu",
      ),
      claims,
      (match, start, end) => ({
        day: Number(match[1]),
        end,
        month: monthNumber(match[2] ?? ""),
        precision: "DATE",
        start,
        year: Number(match[3]),
      }),
    ),
  );
  rawDates.push(
    ...collectMatches(
      text,
      new RegExp(
        `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?[,]?\\s+(20\\d{2}|2100)\\b`,
        "giu",
      ),
      claims,
      (match, start, end) => ({
        day: Number(match[2]),
        end,
        month: monthNumber(match[1] ?? ""),
        precision: "DATE",
        start,
        year: Number(match[3]),
      }),
    ),
  );
  rawDates.push(
    ...collectMatches(
      text,
      /\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2}|2100)\b/gu,
      claims,
      (match, start, end) => {
        const first = Number(match[1]);
        const second = Number(match[2]);
        const year = Number(match[3]);
        const order = first > 12 ? "DMY" : second > 12 ? "MDY" : options.numericDateOrder;
        if (!order && first !== second) {
          return {
            alternatives: [dateString(year, first, second), dateString(year, second, first)].filter(
              (value): value is string => value !== null,
            ),
            end,
            precision: "DATE",
            start,
            year,
          };
        }
        return {
          day: order === "MDY" ? second : first,
          end,
          month: order === "MDY" ? first : second,
          precision: "DATE",
          start,
          year,
        };
      },
    ),
  );
  rawDates.push(
    ...collectMatches(
      text,
      new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(20\\d{2}|2100)\\b`, "giu"),
      claims,
      (match, start, end) => ({
        end,
        month: monthNumber(match[1] ?? ""),
        precision: "MONTH",
        start,
        year: Number(match[2]),
      }),
    ),
  );
  rawDates.push(
    ...collectMatches(
      text,
      /\b(Spring|Summer|Autumn|Fall|Winter)\s+(20\d{2}|2100)\b/giu,
      claims,
      (match, start, end) => ({
        end,
        precision: "SEASON",
        season: match[1]?.toUpperCase(),
        start,
        year: Number(match[2]),
      }),
    ),
  );
  rawDates.push(
    ...collectMatches(
      text,
      new RegExp(`\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "giu"),
      claims,
      (match, start, end) => ({
        day: Number(match[2]),
        end,
        inferredYear: true,
        month: monthNumber(match[1] ?? ""),
        precision: "DATE",
        start,
        year: referenceDate.getUTCFullYear(),
      }),
    ),
  );

  const candidates = rawDates
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .slice(0, MAXIMUM_CANDIDATES)
    .map((raw): DateCandidate => {
      const time = timeDetails(text, raw.end, configuredTimeZone);
      const context = contextKind(text, raw.start, time.end);
      const alternatives = raw.alternatives ?? [];
      let localDate: string | null = null;
      if (raw.precision === "DATE" && raw.year && raw.month && raw.day) {
        localDate = dateString(raw.year, raw.month, raw.day);
      } else if (raw.precision === "MONTH" && raw.year && raw.month) {
        localDate = monthString(raw.year, raw.month);
      } else if (raw.precision === "SEASON" && raw.year && raw.season) {
        localDate = `${raw.year}-${raw.season}`;
      }

      const reasons = new Set<DateReviewReason>();
      if (alternatives.length > 1) {
        reasons.add("AMBIGUOUS_NUMERIC_ORDER");
      }
      if (!localDate && alternatives.length === 0) {
        reasons.add("INVALID_DATE");
      }
      if (raw.inferredYear) {
        reasons.add("INFERRED_YEAR");
      }
      if (raw.precision === "MONTH" || raw.precision === "SEASON") {
        reasons.add("PARTIAL_DATE");
      }
      if (context.conflicting) {
        reasons.add("CONFLICTING_CONTEXT");
      } else if (context.kind === "UNKNOWN") {
        reasons.add("MISSING_CONTEXT");
      }
      if (time.reviewReason) {
        reasons.add(time.reviewReason);
      }

      const reviewReasons = [...reasons].sort();
      return Object.freeze({
        alternatives: Object.freeze([...alternatives]),
        automaticPublication: reviewReasons.length === 0,
        end: time.end,
        kind: context.kind,
        localDate,
        localTime: time.localTime,
        precision: time.localTime && raw.precision === "DATE" ? "DATE_TIME" : raw.precision,
        reviewReasons: Object.freeze(reviewReasons),
        sourceText: text.slice(raw.start, time.end),
        start: raw.start,
        timeZone: time.timeZone,
        timeZoneSource: time.timeZoneSource,
      });
    });

  return candidates;
}
