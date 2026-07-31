import assert from "node:assert/strict";
import test from "node:test";

import type { Prisma } from "@athenvia/database";
import { createCanonicalFieldRevision } from "@athenvia/database";

import { extractDateCandidates } from "../src/parsing";
import { matchDateCandidatesToIntakes } from "../src/verification";

/**
 * Ticket #88 [P4-25] — Conflicting official sources.
 *
 * Two official sources publish contradictory dates for the same application
 * window. The pipeline must route the contradiction to human review instead of
 * publishing either value automatically, keep the previously published value
 * untouched, and preserve both conflicting values with their source evidence.
 *
 * Conflict handling lives in `createCanonicalFieldRevision`
 * (packages/database/src/canonical-revisions.ts): every proposed change becomes
 * a PENDING DataRevision, and competing pending values sharing one conflictKey
 * are all flagged `hasConflict`. Approval is a separate human step
 * (apps/web/app/api/admin/reviews/service.ts) which refuses to approve a
 * conflicted revision while competitors remain pending.
 */

const AS_OF_DATE = "2026-07-31";

const IDS = {
  window: "0f043d91-d700-4ee1-8f66-9a65c7e59301",
  admissionsPageSnapshot: "b47d12fe-ae44-4d2c-a48c-0cf09df12f52",
  admissionsPageSource: "d89c1c64-de81-45c9-b368-ad53f8a25f15",
  programPageSnapshot: "a36c01ef-dc33-4b3c-937b-fbef8ce01e3f",
  programPageSource: "c78b0b53-cd70-44b9-a257-9c42e7914f04",
} as const;

/** Previously published (canonical) deadline of the application window. */
const PUBLISHED_DEADLINE = "2026-12-01";

/** Fixture: correct official program page announces 15 January 2027. */
const PROGRAM_PAGE_TEXT = "The application deadline is 15 January 2027.";
/** Fixture: official admissions page announces 20 January 2027 instead. */
const ADMISSIONS_PAGE_TEXT = "The application deadline is 20 January 2027.";

function singleCandidate(text: string) {
  const parsed = extractDateCandidates(text, {
    referenceDate: new Date(`${AS_OF_DATE}T00:00:00.000Z`),
    timeZone: "UTC",
  });
  assert.equal(parsed.length, 1, text);
  return parsed[0]!;
}

type CreatedRevisionRow = {
  changeStatus: "PENDING";
  conflictKey: string;
  createdByWorker: boolean;
  hasConflict: boolean;
  id: string;
  newValue: unknown;
  oldValue: unknown;
  sourceId: string;
  sourceSnapshotId: string;
};

/**
 * In-memory stand-in for the Prisma transaction used by
 * `createCanonicalFieldRevision`, mirroring the fake in
 * packages/database/tests/canonical-revisions.test.ts but additionally
 * recording full audit columns and spying on canonical-entity writes.
 */
function fakeDatabase() {
  const rows: CreatedRevisionRow[] = [];
  let applicationWindowWrites = 0;
  const snapshots = [
    { id: IDS.programPageSnapshot, sourceId: IDS.programPageSource },
    { id: IDS.admissionsPageSnapshot, sourceId: IDS.admissionsPageSource },
  ];
  const transaction = {
    $executeRaw: async () => 1,
    applicationWindow: {
      update: async () => {
        applicationWindowWrites += 1;
        return {};
      },
    },
    dataRevision: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const id = `revision-${rows.length + 1}`;
        rows.push({
          changeStatus: "PENDING",
          conflictKey: String(data.conflictKey),
          createdByWorker: Boolean(data.createdByWorker),
          hasConflict: Boolean(data.hasConflict),
          id,
          newValue: data.newValue,
          oldValue: data.oldValue,
          sourceId: String(data.sourceId),
          sourceSnapshotId: String(data.sourceSnapshotId),
        });
        return { id };
      },
      findMany: async ({ where }: { where: { conflictKey: string } }) =>
        rows
          .filter(({ conflictKey }) => conflictKey === where.conflictKey)
          .map(({ id, newValue }) => ({ id, newValue })),
      updateMany: async ({ where }: { where: { conflictKey: string } }) => {
        let count = 0;
        for (const row of rows) {
          if (row.conflictKey === where.conflictKey) {
            row.hasConflict = true;
            count += 1;
          }
        }
        return { count };
      },
    },
    sourceSnapshot: {
      findFirst: async ({ where }: { where: { id: string; sourceId: string } }) =>
        snapshots.find(({ id, sourceId }) => id === where.id && sourceId === where.sourceId) ??
        null,
    },
  };
  return {
    database: {
      $transaction: async (callback: (client: typeof transaction) => unknown) =>
        callback(transaction),
    },
    getApplicationWindowWrites: () => applicationWindowWrites,
    rows,
  };
}

function revisionInput(
  proposedValue: Prisma.InputJsonValue,
  sourceId: string,
  sourceSnapshotId: string,
) {
  return {
    creator: { kind: "WORKER" as const },
    currentValue: PUBLISHED_DEADLINE,
    entityId: IDS.window,
    entityType: "APPLICATION_WINDOW",
    fieldName: "closesAt",
    proposedValue,
    sourceId,
    sourceSnapshotId,
  };
}

async function ingestConflictingOfficialSources(fake: ReturnType<typeof fakeDatabase>) {
  const programPage = await createCanonicalFieldRevision(
    fake.database as never,
    revisionInput("2027-01-15", IDS.programPageSource, IDS.programPageSnapshot),
  );
  const admissionsPage = await createCanonicalFieldRevision(
    fake.database as never,
    revisionInput("2027-01-20", IDS.admissionsPageSource, IDS.admissionsPageSnapshot),
  );
  return { admissionsPage, programPage };
}

test("contradictory official deadlines for the same window are detected as a conflict", async () => {
  const programCandidate = singleCandidate(PROGRAM_PAGE_TEXT);
  const admissionsCandidate = singleCandidate(ADMISSIONS_PAGE_TEXT);

  // Both documents parse cleanly: taken in isolation, each candidate would be
  // eligible for automatic publication.
  assert.equal(programCandidate.kind, "APPLICATION_DEADLINE");
  assert.equal(admissionsCandidate.kind, "APPLICATION_DEADLINE");
  assert.equal(programCandidate.localDate, "2027-01-15");
  assert.equal(admissionsCandidate.localDate, "2027-01-20");
  assert.equal(programCandidate.automaticPublication, true);
  assert.equal(admissionsCandidate.automaticPublication, true);

  // Both candidates resolve to the same intake and round, i.e. the same
  // canonical application-window field.
  const matches = matchDateCandidatesToIntakes(
    [
      { candidate: programCandidate, evidenceId: "program-page-deadline" },
      { candidate: admissionsCandidate, evidenceId: "admissions-page-deadline" },
    ],
    [
      {
        applicationRounds: [{ id: "round-1", roundName: null }],
        id: "intake-2027-09",
        month: 9,
        startDate: "2027-09-01",
        year: 2027,
      },
    ],
    { asOfDate: AS_OF_DATE },
  );
  assert.equal(matches.length, 2);
  for (const match of matches) {
    assert.equal(match.status, "MATCHED");
    assert.equal(match.intakeId, "intake-2027-09");
    assert.equal(match.applicationRoundId, "round-1");
  }

  // The contradiction is detected when both proposals reach the canonical
  // revision store for the same conflict key.
  const fake = fakeDatabase();
  const { admissionsPage, programPage } = await ingestConflictingOfficialSources(fake);

  assert.equal(programPage.outcome, "PENDING");
  assert.equal(admissionsPage.outcome, "CONFLICT");
  assert.equal(programPage.conflictKey, admissionsPage.conflictKey);
  assert.equal(programPage.conflictKey, `APPLICATION_WINDOW:${IDS.window}:closesAt`);
  assert.equal(fake.rows.length, 2);
  assert.equal(
    fake.rows.every(({ hasConflict }) => hasConflict),
    true,
  );
});

test("automatic publication is blocked: revisions stay pending and the published value is untouched", async () => {
  const fake = fakeDatabase();
  const { programPage } = await ingestConflictingOfficialSources(fake);

  // Neither side is approved: both revisions await human review.
  assert.equal(
    fake.rows.every(({ changeStatus }) => changeStatus === "PENDING"),
    true,
  );

  // The canonical application window is never written inside revision intake,
  // so the previously published deadline remains what users see.
  assert.equal(fake.getApplicationWindowWrites(), 0);
  assert.equal(
    fake.rows.every(({ oldValue }) => oldValue === PUBLISHED_DEADLINE),
    true,
  );

  // Re-fetching the first source while the conflict is open is idempotent: it
  // reuses the pending revision, still reports the conflict, and publishes
  // nothing.
  const refetch = await createCanonicalFieldRevision(
    fake.database as never,
    revisionInput("2027-01-15", IDS.programPageSource, IDS.programPageSnapshot),
  );
  assert.equal(refetch.outcome, "CONFLICT");
  assert.equal(refetch.revisionId, programPage.revisionId);
  assert.equal(fake.rows.length, 2);
});

test("both conflicting values and their source evidence remain auditable", async () => {
  const fake = fakeDatabase();
  await ingestConflictingOfficialSources(fake);

  const byValue = new Map(fake.rows.map((row) => [row.newValue, row]));
  const programRow = byValue.get("2027-01-15");
  const admissionsRow = byValue.get("2027-01-20");
  assert.notEqual(programRow, undefined);
  assert.notEqual(admissionsRow, undefined);

  // Each side keeps its own immutable evidence chain.
  assert.equal(programRow!.sourceId, IDS.programPageSource);
  assert.equal(programRow!.sourceSnapshotId, IDS.programPageSnapshot);
  assert.equal(admissionsRow!.sourceId, IDS.admissionsPageSource);
  assert.equal(admissionsRow!.sourceSnapshotId, IDS.admissionsPageSnapshot);

  // Both rows are attributed to the worker and share one conflict key, so a
  // reviewer can load the full set of competing values for the decision.
  assert.equal(
    fake.rows.every(({ createdByWorker }) => createdByWorker),
    true,
  );
  assert.equal(new Set(fake.rows.map(({ conflictKey }) => conflictKey)).size, 1);
  // The pre-conflict published value is recorded on both sides as well.
  assert.equal(
    fake.rows.every(({ oldValue }) => oldValue === PUBLISHED_DEADLINE),
    true,
  );
});

test("gap: the verification layer alone does not flag cross-source contradictions", () => {
  // Documented current behavior: `matchDateCandidatesToIntakes` evaluates each
  // piece of evidence independently. Two contradictory official candidates for
  // the same window both come back MATCHED with no conflict reason; only the
  // canonical revision store (createCanonicalFieldRevision) catches the
  // contradiction, and only once both proposals are actually submitted to it.
  const matches = matchDateCandidatesToIntakes(
    [
      { candidate: singleCandidate(PROGRAM_PAGE_TEXT), evidenceId: "program-page-deadline" },
      { candidate: singleCandidate(ADMISSIONS_PAGE_TEXT), evidenceId: "admissions-page-deadline" },
    ],
    [
      {
        applicationRounds: [{ id: "round-1", roundName: null }],
        id: "intake-2027-09",
        month: 9,
        startDate: "2027-09-01",
        year: 2027,
      },
    ],
    { asOfDate: AS_OF_DATE },
  );

  assert.deepEqual(
    matches.map(({ reasons, status }) => ({ reasons: [...reasons], status })),
    [
      { reasons: [], status: "MATCHED" },
      { reasons: [], status: "MATCHED" },
    ],
  );
});

// The worker currently wires only notification delivery and reminder sweeps
// (apps/worker/src/index.ts). No worker job feeds parsed candidates into
// createCanonicalFieldRevision yet, so the conflict guard proven above is not
// exercised end-to-end by the pipeline itself.
test.todo(
  "wire the fetch -> parse -> verify pipeline to createCanonicalFieldRevision so cross-source conflicts are raised in production",
);

// createCanonicalFieldRevision treats all competing proposals alike; it does
// not record whether each side came from an official source, so a reviewer must
// consult the linked Source rows to weigh officialness during arbitration.
test.todo(
  "capture source officialness (and source priority from docs/ARCHITECTURE.md) on conflicted revisions to support review arbitration",
);
