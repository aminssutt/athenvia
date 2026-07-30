import assert from "node:assert/strict";
import test from "node:test";

import { extractDateCandidates } from "../parsing";
import {
  matchDateCandidatesToIntakes,
  type IntakeDateEvidence,
  type MatchableIntake,
} from "./intake-matching";

const AS_OF_DATE = "2026-07-30";

function candidate(text: string) {
  const parsed = extractDateCandidates(text, {
    referenceDate: new Date(`${AS_OF_DATE}T00:00:00.000Z`),
    timeZone: "UTC",
  });
  assert.equal(parsed.length, 1, text);
  return parsed[0]!;
}

function intake(
  id: string,
  year: number,
  month: number | null,
  rounds: Array<{ id: string; roundName: string | null }> = [],
): MatchableIntake {
  return {
    applicationRounds: rounds,
    id,
    month,
    startDate: month === null ? null : `${year}-${String(month).padStart(2, "0")}-01`,
    year,
  };
}

function match(evidence: readonly IntakeDateEvidence[], intakes: readonly MatchableIntake[]) {
  return matchDateCandidatesToIntakes(evidence, intakes, { asOfDate: AS_OF_DATE });
}

test("rejects an explicitly targeted old intake", () => {
  const [result] = match(
    [
      {
        candidate: candidate("The application deadline is 15 January 2025."),
        evidenceId: "old-deadline",
        intakeHint: { month: 9, year: 2025 },
      },
    ],
    [intake("intake-2025-09", 2025, 9)],
  );

  assert.deepEqual(result, {
    applicationRoundId: null,
    evidenceId: "old-deadline",
    intakeId: null,
    reasons: ["OLD_INTAKE"],
    roundKey: null,
    roundName: null,
    status: "REJECTED",
  });
});

test("matches separate application rounds without collapsing them", () => {
  const rounds = [
    { id: "round-1", roundName: "Round 1" },
    { id: "round-2", roundName: "Round 2" },
  ];
  const results = match(
    [
      {
        candidate: candidate("Apply by 15 January 2027."),
        evidenceId: "round-one-deadline",
        intakeHint: { month: 9, year: 2027 },
        roundNameHint: "Round 1",
      },
      {
        candidate: candidate("Apply by 30 April 2027."),
        evidenceId: "round-two-deadline",
        intakeHint: { month: 9, year: 2027 },
        roundNameHint: "round 2",
      },
    ],
    [intake("intake-2027-09", 2027, 9, rounds)],
  );

  assert.deepEqual(
    results.map(({ applicationRoundId, roundKey, status }) => ({
      applicationRoundId,
      roundKey,
      status,
    })),
    [
      { applicationRoundId: "round-1", roundKey: "round 1", status: "MATCHED" },
      { applicationRoundId: "round-2", roundKey: "round 2", status: "MATCHED" },
    ],
  );
});

test("proposes a stable new round without merging an existing one", () => {
  const [result] = match(
    [
      {
        candidate: candidate("Applications open 1 November 2026."),
        evidenceId: "early-round",
        intakeHint: { month: 9, year: 2027 },
        roundNameHint: "Early & Priority",
      },
    ],
    [intake("intake-2027-09", 2027, 9, [{ id: "regular", roundName: "Regular" }])],
  );

  assert.equal(result?.status, "MATCHED");
  assert.equal(result?.applicationRoundId, null);
  assert.equal(result?.roundName, "Early & Priority");
  assert.equal(result?.roundKey, "early and priority");
});

test("routes an unlabelled date to review when several rounds exist", () => {
  const [result] = match(
    [
      {
        candidate: candidate("Apply by 15 January 2027."),
        evidenceId: "unlabelled-deadline",
        intakeHint: { month: 9, year: 2027 },
      },
    ],
    [
      intake("intake-2027-09", 2027, 9, [
        { id: "round-1", roundName: "Round 1" },
        { id: "round-2", roundName: "Round 2" },
      ]),
    ],
  );

  assert.equal(result?.status, "REVIEW");
  assert.equal(result?.intakeId, "intake-2027-09");
  assert.deepEqual(result?.reasons, ["AMBIGUOUS_ROUND"]);
});

test("routes a year-only hint to review when several intakes match", () => {
  const [result] = match(
    [
      {
        candidate: candidate("Apply by 15 January 2027."),
        evidenceId: "ambiguous-intake",
        intakeHint: { year: 2027 },
      },
    ],
    [intake("intake-2027-01", 2027, 1), intake("intake-2027-09", 2027, 9)],
  );

  assert.equal(result?.status, "REVIEW");
  assert.equal(result?.intakeId, null);
  assert.deepEqual(result?.reasons, ["AMBIGUOUS_INTAKE"]);
});

test("derives the exact intake from an intake-start candidate", () => {
  const [result] = match(
    [
      {
        candidate: candidate("Classes begin 6 September 2027."),
        evidenceId: "intake-start",
        intakeHint: { year: 2027 },
      },
    ],
    [intake("intake-2027-01", 2027, 1), intake("intake-2027-09", 2027, 9)],
  );

  assert.equal(result?.status, "MATCHED");
  assert.equal(result?.intakeId, "intake-2027-09");
  assert.equal(result?.applicationRoundId, null);
  assert.equal(result?.roundKey, null);
});

test("does not override a conflicting explicit intake hint", () => {
  const [result] = match(
    [
      {
        candidate: candidate("The programme starts 6 September 2027."),
        evidenceId: "conflicting-hint",
        intakeHint: { month: 1, year: 2028 },
      },
    ],
    [intake("intake-2027-09", 2027, 9), intake("intake-2028-01", 2028, 1)],
  );

  assert.equal(result?.status, "REVIEW");
  assert.equal(result?.intakeId, null);
  assert.deepEqual(result?.reasons, ["CONFLICTING_INTAKE_HINT"]);
});

test("keeps parser ambiguity in review after a unique intake match", () => {
  const [result] = match(
    [
      {
        candidate: candidate("Apply by 03/04/2027."),
        evidenceId: "numeric-ambiguity",
        intakeHint: { month: 9, year: 2027 },
      },
    ],
    [intake("intake-2027-09", 2027, 9)],
  );

  assert.equal(result?.status, "REVIEW");
  assert.equal(result?.intakeId, "intake-2027-09");
  assert.deepEqual(result?.reasons, ["CANDIDATE_REQUIRES_REVIEW"]);
});

test("chooses a sole chronological intake but never guesses between several", () => {
  const parsed = candidate("Applications close 31 January 2027.");
  const [unique] = match(
    [{ candidate: parsed, evidenceId: "unique-future" }],
    [intake("old", 2025, 9), intake("future", 2027, 9)],
  );
  assert.equal(unique?.status, "MATCHED");
  assert.equal(unique?.intakeId, "future");

  const [ambiguous] = match(
    [{ candidate: parsed, evidenceId: "several-future" }],
    [intake("future-2027", 2027, 9), intake("future-2028", 2028, 9)],
  );
  assert.equal(ambiguous?.status, "REVIEW");
  assert.deepEqual(ambiguous?.reasons, ["AMBIGUOUS_INTAKE"]);
});

test("rejects invalid deterministic inputs", () => {
  assert.throws(
    () =>
      matchDateCandidatesToIntakes([], [], {
        asOfDate: "30/07/2026",
      }),
    TypeError,
  );
  assert.throws(
    () =>
      matchDateCandidatesToIntakes(
        [
          {
            candidate: candidate("Apply by 15 January 2027."),
            evidenceId: "same",
          },
          {
            candidate: candidate("Apply by 16 January 2027."),
            evidenceId: "same",
          },
        ],
        [],
        { asOfDate: AS_OF_DATE },
      ),
    TypeError,
  );
});
