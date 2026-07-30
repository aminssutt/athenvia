import assert from "node:assert/strict";
import test from "node:test";

import { generateConservativeExpectedDate, type HistoricalDateEvidence } from "./expected-dates";

function evidence(
  evidenceId: string,
  intakeYear: number,
  observedDate: string,
  overrides: Partial<HistoricalDateEvidence> = {},
): HistoricalDateEvidence {
  return {
    evidenceId,
    field: "APPLICATION_DEADLINE",
    intakeYear,
    observedDate,
    officialSource: true,
    roundKey: "regular",
    sourceSnapshotId: `snapshot-${evidenceId}`,
    ...overrides,
  };
}

const target = {
  field: "APPLICATION_DEADLINE" as const,
  intakeYear: 2027,
  roundKey: "regular",
};

test("uses consistent official cycles to estimate a month, never an exact day", () => {
  const decision = generateConservativeExpectedDate(
    [evidence("2026", 2026, "2026-01-19"), evidence("2025", 2025, "2025-01-12")],
    target,
  );

  assert.equal(decision.publicStatus, "EXPECTED");
  assert.deepEqual(decision.estimate, {
    localDate: "2027-01",
    precision: "MONTH",
    publicStatus: "EXPECTED",
    verificationStatus: "EXPECTED",
    wording: {
      description:
        "Based on prior official cycles. The university has not published the official date yet.",
      title: "Expected date",
    },
  });
  assert.doesNotMatch(decision.estimate?.localDate ?? "", /^\d{4}-\d{2}-\d{2}$/u);
  assert.deepEqual(
    decision.evidence.map(({ evidenceId, sourceSnapshotId }) => ({
      evidenceId,
      sourceSnapshotId,
    })),
    [
      { evidenceId: "2025", sourceSnapshotId: "snapshot-2025" },
      { evidenceId: "2026", sourceSnapshotId: "snapshot-2026" },
    ],
  );
});

test("falls back from differing months to one conservative season", () => {
  const decision = generateConservativeExpectedDate(
    [evidence("march", 2025, "2025-03-10"), evidence("may", 2026, "2026-05")],
    target,
  );

  assert.equal(decision.estimate?.localDate, "2027-SPRING");
  assert.equal(decision.estimate?.precision, "SEASON");
});

test("preserves a stable previous-calendar-year offset", () => {
  const decision = generateConservativeExpectedDate(
    [
      evidence("open-2025", 2025, "2024-09-01", { field: "APPLICATION_OPEN" }),
      evidence("open-2026", 2026, "2025-09-08", { field: "APPLICATION_OPEN" }),
    ],
    { field: "APPLICATION_OPEN", intakeYear: 2027, roundKey: "regular" },
  );

  assert.equal(decision.estimate?.localDate, "2026-09");
});

test("does not estimate from one official cycle or repeated sources in one cycle", () => {
  const oneCycle = generateConservativeExpectedDate(
    [evidence("source-a", 2026, "2026-01-10"), evidence("source-b", 2026, "2026-01-14")],
    target,
  );

  assert.equal(oneCycle.estimate, null);
  assert.equal(oneCycle.publicStatus, "NOT_PUBLISHED");
  assert.deepEqual(oneCycle.reasons, ["INSUFFICIENT_OFFICIAL_HISTORY"]);
  assert.equal(oneCycle.wording.title, "Not published yet");
});

test("ignores unofficial, current, future, other-field, and other-round evidence", () => {
  const ignored = [
    evidence("unofficial", 2025, "2025-01-10", { officialSource: false }),
    evidence("current", 2027, "2027-01-10"),
    evidence("future", 2028, "2028-01-10"),
    evidence("opening", 2025, "2025-09-10", { field: "APPLICATION_OPEN" }),
    evidence("priority", 2025, "2025-01-10", { roundKey: "priority" }),
  ];
  const decision = generateConservativeExpectedDate(
    [...ignored, evidence("eligible", 2026, "2026-01-10")],
    target,
  );

  assert.equal(decision.estimate, null);
  assert.deepEqual(decision.ignoredEvidenceIds, [
    "opening",
    "priority",
    "unofficial",
    "current",
    "future",
  ]);
  assert.deepEqual(
    decision.evidence.map(({ evidenceId }) => evidenceId),
    ["eligible"],
  );
});

test("refuses conflicting seasons, year offsets, and contradictions within a cycle", () => {
  const cases: HistoricalDateEvidence[][] = [
    [evidence("winter", 2025, "2025-01-10"), evidence("summer", 2026, "2026-07-10")],
    [evidence("same-year", 2025, "2025-01-10"), evidence("previous-year", 2026, "2025-01-10")],
    [
      evidence("cycle-a", 2025, "2025-01-10"),
      evidence("cycle-b", 2025, "2025-07-10"),
      evidence("other-cycle", 2026, "2026-01-10"),
    ],
  ];

  for (const history of cases) {
    const decision = generateConservativeExpectedDate(history, target);
    assert.equal(decision.estimate, null);
    assert.deepEqual(decision.reasons, ["CONFLICTING_HISTORY"]);
  }
});

test("accepts season-only history but still emits only season precision", () => {
  const decision = generateConservativeExpectedDate(
    [evidence("fall-2025", 2025, "2025-FALL"), evidence("autumn-2026", 2026, "2026-AUTUMN")],
    target,
  );

  assert.equal(decision.estimate?.localDate, "2027-AUTUMN");
  assert.equal(decision.estimate?.precision, "SEASON");
});

test("rejects evidence without durable provenance or valid dates", () => {
  assert.throws(
    () =>
      generateConservativeExpectedDate(
        [evidence("missing-snapshot", 2025, "2025-01-01", { sourceSnapshotId: "" })],
        target,
      ),
    TypeError,
  );
  assert.throws(
    () => generateConservativeExpectedDate([evidence("invalid", 2025, "2025-02-31")], target),
    TypeError,
  );
});
