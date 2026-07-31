import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { extractDateCandidates } from "../src/parsing";
import {
  matchDateCandidatesToIntakes,
  type IntakeDateEvidence,
  type MatchableIntake,
} from "../src/verification/intake-matching";

const AS_OF_DATE = "2026-07-30";

function candidate(text: string) {
  // Arrange helper: parse a single, unambiguous candidate from real page wording.
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

describe("old intake dates stay off the current intake", () => {
  it("rejects a 2025 deadline hinted at the past intake instead of attaching it to 2026/2027", () => {
    // Arrange: the page still lists last cycle's deadline, explicitly tied to the 2025 intake.
    const oldIntake = intake("intake-2025-09", 2025, 9, [
      { id: "old-regular", roundName: "Regular" },
    ]);
    const currentIntake = intake("intake-2026-09", 2026, 9, [
      { id: "current-regular", roundName: "Regular" },
    ]);

    // Act
    const [result] = match(
      [
        {
          candidate: candidate("The application deadline is 15 January 2025."),
          evidenceId: "stale-2025-deadline",
          intakeHint: { month: 9, year: 2025 },
          roundNameHint: "Regular",
        },
      ],
      [oldIntake, currentIntake],
    );

    // Assert: rejected outright, never re-attached to the current intake or one of its rounds.
    assert.equal(result?.status, "REJECTED");
    assert.deepEqual(result?.reasons, ["OLD_INTAKE"]);
    assert.equal(result?.intakeId, null);
    assert.notEqual(result?.intakeId, currentIntake.id);
    assert.equal(result?.applicationRoundId, null);
  });

  it("rejects an old-intake date even when the past intake is the only one on file", () => {
    // Arrange
    const evidence: IntakeDateEvidence = {
      candidate: candidate("Apply by 30 April 2025."),
      evidenceId: "orphan-old-deadline",
      intakeHint: { month: 9, year: 2025 },
    };

    // Act
    const [result] = match([evidence], [intake("intake-2025-09", 2025, 9)]);

    // Assert
    assert.equal(result?.status, "REJECTED");
    assert.deepEqual(result?.reasons, ["OLD_INTAKE"]);
    assert.equal(result?.intakeId, null);
  });

  it("does not attach an un-hinted deadline already in the past to the current intake without review", () => {
    // Arrange: a stale page still lists last cycle's deadline without any intake context,
    // while a current intake with its own round is on file next to the old one.
    const oldIntake = intake("intake-2025-09", 2025, 9, [
      { id: "old-regular", roundName: "Regular" },
    ]);
    const currentIntake = intake("intake-2026-09", 2026, 9, [
      { id: "current-regular", roundName: "Regular" },
    ]);

    // Act: 2025-01-15 lies before asOfDate (2026-07-30) and carries no intake hint.
    const [result] = match(
      [
        {
          candidate: candidate("The application deadline is 15 January 2025."),
          evidenceId: "stale-unhinted-deadline",
        },
      ],
      [oldIntake, currentIntake],
    );

    // Assert: never silently MATCHED to the current intake — surfaced for human review.
    assert.equal(result?.status, "REVIEW");
    assert.deepEqual(result?.reasons, ["STALE_CANDIDATE"]);
    assert.equal(result?.intakeId, null);
    assert.notEqual(result?.intakeId, currentIntake.id);
    assert.equal(result?.applicationRoundId, null);
  });
});

describe("multiple rounds of one intake stay distinct and ordered", () => {
  const rounds = [
    { id: "round-priority", roundName: "Priority" },
    { id: "round-regular", roundName: "Regular" },
    { id: "round-rolling", roundName: "Rolling" },
  ];

  it("keeps priority, regular and rolling deadlines as three distinct rounds of the same intake", () => {
    // Arrange: three deadlines of the same 2027/09 intake, in priority < regular < rolling order.
    const priorityDeadline = candidate("Apply by 15 November 2026.");
    const regularDeadline = candidate("Apply by 15 January 2027.");
    const rollingDeadline = candidate("Apply by 30 June 2027.");

    // Act
    const results = match(
      [
        {
          candidate: priorityDeadline,
          evidenceId: "priority-deadline",
          intakeHint: { month: 9, year: 2027 },
          roundNameHint: "Priority",
        },
        {
          candidate: regularDeadline,
          evidenceId: "regular-deadline",
          intakeHint: { month: 9, year: 2027 },
          roundNameHint: "Regular",
        },
        {
          candidate: rollingDeadline,
          evidenceId: "rolling-deadline",
          intakeHint: { month: 9, year: 2027 },
          roundNameHint: "Rolling",
        },
      ],
      [intake("intake-2027-09", 2027, 9, rounds)],
    );

    // Assert: every deadline matched, all on the same intake, one distinct round each (no fusion).
    assert.deepEqual(
      results.map(({ applicationRoundId, intakeId, roundKey, status }) => ({
        applicationRoundId,
        intakeId,
        roundKey,
        status,
      })),
      [
        {
          applicationRoundId: "round-priority",
          intakeId: "intake-2027-09",
          roundKey: "priority",
          status: "MATCHED",
        },
        {
          applicationRoundId: "round-regular",
          intakeId: "intake-2027-09",
          roundKey: "regular",
          status: "MATCHED",
        },
        {
          applicationRoundId: "round-rolling",
          intakeId: "intake-2027-09",
          roundKey: "rolling",
          status: "MATCHED",
        },
      ],
    );
    assert.equal(new Set(results.map(({ applicationRoundId }) => applicationRoundId)).size, 3);

    // Assert: the round dates keep their chronological order (priority < regular < rolling).
    const deadlines = [priorityDeadline, regularDeadline, rollingDeadline].map(
      ({ localDate }) => localDate,
    );
    assert.deepEqual(deadlines, ["2026-11-15", "2027-01-15", "2027-06-30"]);
    assert.deepEqual(deadlines, [...deadlines].sort());
  });

  it("proposes a new round without overwriting an existing round of the intake", () => {
    // Arrange: only "Regular" exists; the page announces a separate priority deadline.
    const existing = [{ id: "round-regular", roundName: "Regular" }];

    // Act
    const [result] = match(
      [
        {
          candidate: candidate("Apply by 15 November 2026."),
          evidenceId: "new-priority-round",
          intakeHint: { month: 9, year: 2027 },
          roundNameHint: "Priority",
        },
      ],
      [intake("intake-2027-09", 2027, 9, existing)],
    );

    // Assert: matched as a new round key, not squashed onto the existing round's ID.
    assert.equal(result?.status, "MATCHED");
    assert.equal(result?.intakeId, "intake-2027-09");
    assert.equal(result?.applicationRoundId, null);
    assert.equal(result?.roundKey, "priority");
    assert.equal(result?.roundName, "Priority");
  });

  it("routes an unlabelled deadline to review instead of overwriting one of several rounds", () => {
    // Act
    const [result] = match(
      [
        {
          candidate: candidate("Apply by 15 January 2027."),
          evidenceId: "unlabelled-deadline",
          intakeHint: { month: 9, year: 2027 },
        },
      ],
      [intake("intake-2027-09", 2027, 9, rounds)],
    );

    // Assert: no silent pick among Priority/Regular/Rolling.
    assert.equal(result?.status, "REVIEW");
    assert.equal(result?.intakeId, "intake-2027-09");
    assert.equal(result?.applicationRoundId, null);
    assert.deepEqual(result?.reasons, ["AMBIGUOUS_ROUND"]);
  });
});

describe("association targets the correct intake when several coexist", () => {
  const springIntake = intake("intake-2027-01", 2027, 1, [
    { id: "spring-regular", roundName: "Regular" },
  ]);
  const fallIntake = intake("intake-2027-09", 2027, 9, [
    { id: "fall-regular", roundName: "Regular" },
  ]);

  it("routes each hinted deadline to its own intake when spring and fall coexist", () => {
    // Act
    const results = match(
      [
        {
          candidate: candidate("Apply by 15 October 2026."),
          evidenceId: "spring-deadline",
          intakeHint: { month: 1, year: 2027 },
        },
        {
          candidate: candidate("Apply by 15 April 2027."),
          evidenceId: "fall-deadline",
          intakeHint: { month: 9, year: 2027 },
        },
      ],
      [springIntake, fallIntake],
    );

    // Assert: each deadline lands on its own intake and that intake's own round.
    assert.deepEqual(
      results.map(({ applicationRoundId, evidenceId, intakeId, status }) => ({
        applicationRoundId,
        evidenceId,
        intakeId,
        status,
      })),
      [
        {
          applicationRoundId: "spring-regular",
          evidenceId: "spring-deadline",
          intakeId: "intake-2027-01",
          status: "MATCHED",
        },
        {
          applicationRoundId: "fall-regular",
          evidenceId: "fall-deadline",
          intakeId: "intake-2027-09",
          status: "MATCHED",
        },
      ],
    );
  });

  it("derives the fall intake from an un-hinted intake-start date without touching spring", () => {
    // Act
    const [result] = match(
      [
        {
          candidate: candidate("Classes begin 6 September 2027."),
          evidenceId: "fall-intake-start",
        },
      ],
      [springIntake, fallIntake],
    );

    // Assert
    assert.equal(result?.status, "MATCHED");
    assert.equal(result?.intakeId, "intake-2027-09");
    assert.equal(result?.applicationRoundId, null);
  });

  it("routes a year-only hint to review rather than guessing between spring and fall", () => {
    // Act
    const [result] = match(
      [
        {
          candidate: candidate("Apply by 15 April 2027."),
          evidenceId: "season-less-deadline",
          intakeHint: { year: 2027 },
        },
      ],
      [springIntake, fallIntake],
    );

    // Assert
    assert.equal(result?.status, "REVIEW");
    assert.equal(result?.intakeId, null);
    assert.deepEqual(result?.reasons, ["AMBIGUOUS_INTAKE"]);
  });
});
