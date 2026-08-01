import type { Logger } from "pino";

import { extractDateCandidates, extractSafeText } from "../parsing";
import { matchDateCandidatesToIntakes } from "../verification";

import type { DateCandidate } from "../parsing";
import type { IntakeDateEvidence, MatchableIntake } from "../verification";

export type ParseableWindow = {
  id: string;
  roundName: string | null;
  opensAt: Date | null;
  closesAt: Date | null;
};

export type ParseableIntake = {
  id: string;
  year: number;
  month: number | null;
  startDate: Date | null;
  applicationWindows: readonly ParseableWindow[];
};

export type ParseableSnapshot = {
  id: string;
  sourceId: string;
  storageKey: string;
  /** United States publications order numeric dates month-first. */
  universityCountryCode: string | null;
  intakes: readonly ParseableIntake[];
};

export type ProposedRevision = {
  entityId: string;
  fieldName: "opensAt" | "closesAt";
  currentValue: string | null;
  proposedValue: string;
};

export type ParseProcessorDependencies = {
  loadSnapshot: (sourceSnapshotId: string) => Promise<ParseableSnapshot | null>;
  readSnapshotBody: (storageKey: string) => Promise<Buffer>;
  createRevision: (
    snapshot: ParseableSnapshot,
    proposal: ProposedRevision,
  ) => Promise<{ outcome: "CONFLICT" | "PENDING" | "UNCHANGED"; revisionId: string | null }>;
  enqueueReview: (revisionId: string) => Promise<void>;
  logger: Logger;
  now?: () => Date;
};

export type ParseProcessorResult = {
  outcome: "PARSED" | "SKIPPED";
  candidates: number;
  matched: number;
  revisionsCreated: number;
};

function detectContentType(body: Buffer): string {
  if (body.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  const head = body.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html") || head.includes("<body")) {
    return "text/html";
  }
  return "text/plain";
}

/**
 * Converts one matched candidate into an exact UTC instant, or null when the
 * evidence is not precise enough to publish mechanically. A date published as
 * a day without a time of day is stored at noon UTC — the same normalisation
 * the curated seeds use — so the rendered calendar day matches the published
 * one in every timezone and a reminder can only ever fire early.
 */
export function candidateInstant(candidate: DateCandidate): string | null {
  if (!candidate.localDate) {
    return null;
  }
  if (candidate.precision === "DATE") {
    return `${candidate.localDate}T12:00:00.000Z`;
  }
  if (
    candidate.precision === "DATE_TIME" &&
    candidate.localTime &&
    (candidate.timeZone === "UTC" || candidate.timeZone === "Etc/UTC")
  ) {
    const time =
      candidate.localTime.length === 5 ? `${candidate.localTime}:00` : candidate.localTime;
    return `${candidate.localDate}T${time}.000Z`;
  }
  return null;
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Extracts date candidates from one immutable snapshot, matches them onto the
 * programme's intakes and records every publishable change as a pending data
 * revision. Nothing is ever written to the public catalogue here: revisions
 * wait for the review stage and the admin queue.
 */
export async function processParseJob(
  sourceSnapshotId: string,
  dependencies: ParseProcessorDependencies,
): Promise<ParseProcessorResult> {
  const now = dependencies.now ?? (() => new Date());
  const snapshot = await dependencies.loadSnapshot(sourceSnapshotId);
  if (!snapshot) {
    dependencies.logger.warn({ event: "pipeline.parse_snapshot_missing", sourceSnapshotId });
    return { outcome: "SKIPPED", candidates: 0, matched: 0, revisionsCreated: 0 };
  }
  if (snapshot.intakes.length === 0) {
    dependencies.logger.info({ event: "pipeline.parse_no_intakes", sourceSnapshotId });
    return { outcome: "SKIPPED", candidates: 0, matched: 0, revisionsCreated: 0 };
  }

  const body = await dependencies.readSnapshotBody(snapshot.storageKey);
  const text = extractSafeText({ body, contentType: detectContentType(body) }).text;
  const referenceDate = now();
  const candidates = extractDateCandidates(text, {
    numericDateOrder: snapshot.universityCountryCode === "US" ? "MDY" : "DMY",
    referenceDate,
    timeZone: "UTC",
  });

  const relevant = candidates.filter(
    (candidate) =>
      candidate.kind === "APPLICATION_DEADLINE" || candidate.kind === "APPLICATION_OPEN",
  );
  const evidence: IntakeDateEvidence[] = relevant.map((candidate, index) => ({
    candidate,
    evidenceId: `candidate-${index}`,
  }));
  const evidenceById = new Map(evidence.map((item) => [item.evidenceId, item]));

  const matchableIntakes: MatchableIntake[] = snapshot.intakes.map((intake) => ({
    applicationRounds: intake.applicationWindows.map((window) => ({
      id: window.id,
      roundName: window.roundName,
    })),
    id: intake.id,
    month: intake.month,
    startDate: intake.startDate ? isoDay(intake.startDate) : null,
    year: intake.year,
  }));
  const matches = matchDateCandidatesToIntakes(evidence, matchableIntakes, {
    asOfDate: isoDay(referenceDate),
  });

  const windowsById = new Map(
    snapshot.intakes.flatMap((intake) => intake.applicationWindows.map((w) => [w.id, w] as const)),
  );
  const intakesById = new Map(snapshot.intakes.map((intake) => [intake.id, intake]));

  let matched = 0;
  let revisionsCreated = 0;
  for (const match of matches) {
    if (match.status !== "MATCHED" || !match.intakeId) {
      continue;
    }
    matched += 1;

    const item = evidenceById.get(match.evidenceId);
    if (!item) {
      continue;
    }
    const instant = candidateInstant(item.candidate);
    if (!instant) {
      continue;
    }

    const intake = intakesById.get(match.intakeId);
    const window =
      (match.applicationRoundId ? windowsById.get(match.applicationRoundId) : undefined) ??
      (intake && intake.applicationWindows.length === 1 ? intake.applicationWindows[0] : undefined);
    if (!window) {
      dependencies.logger.info({
        event: "pipeline.parse_window_unresolved",
        intakeId: match.intakeId,
        sourceSnapshotId,
      });
      continue;
    }

    const fieldName = item.candidate.kind === "APPLICATION_DEADLINE" ? "closesAt" : "opensAt";
    const currentDate = fieldName === "closesAt" ? window.closesAt : window.opensAt;
    const proposal: ProposedRevision = {
      currentValue: currentDate ? currentDate.toISOString() : null,
      entityId: window.id,
      fieldName,
      proposedValue: instant,
    };
    if (proposal.currentValue === proposal.proposedValue) {
      continue;
    }

    const revision = await dependencies.createRevision(snapshot, proposal);
    if (revision.revisionId && revision.outcome !== "UNCHANGED") {
      revisionsCreated += 1;
      await dependencies.enqueueReview(revision.revisionId);
    }
  }

  dependencies.logger.info({
    candidates: relevant.length,
    event: "pipeline.parse_completed",
    matched,
    revisionsCreated,
    sourceSnapshotId,
  });
  return { outcome: "PARSED", candidates: relevant.length, matched, revisionsCreated };
}
