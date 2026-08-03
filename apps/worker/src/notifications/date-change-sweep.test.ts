import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runDateChangePlanningSweep } from "./date-change-sweep";

import type { DateChangePlanningRepositoryResult } from "./date-change-notifications";
import type { DateChangePlanningSweepDependencies } from "./date-change-sweep";

const NOW = new Date("2027-01-10T09:00:00.000Z");
const REVISION_A = "11111111-1111-4111-8111-111111111111";
const REVISION_B = "22222222-2222-4222-8222-222222222222";
const REVISION_C = "33333333-3333-4333-8333-333333333333";

function dependencies(
  ids: string[],
  results: Record<string, DateChangePlanningRepositoryResult>,
): DateChangePlanningSweepDependencies & { planned: Array<{ now: Date; revisionId: string }> } {
  const planned: Array<{ now: Date; revisionId: string }> = [];
  return {
    listApprovedRevisionIds: (reviewedSince, limit) => {
      assert.ok(reviewedSince.getTime() < NOW.getTime());
      assert.ok(limit >= 1);
      return Promise.resolve(ids);
    },
    plan: (revisionId, now) => {
      planned.push({ now, revisionId });
      const result = results[revisionId];
      assert.ok(result, `unexpected revision ${revisionId}`);
      return Promise.resolve(result);
    },
    planned,
  };
}

describe("date-change planning sweep", () => {
  it("plans every recently approved revision and aggregates the outcomes", async () => {
    const deps = dependencies([REVISION_A, REVISION_B, REVISION_C], {
      [REVISION_A]: {
        cancelledStaleCount: 1,
        createdCount: 3,
        eligibleCount: 3,
        revisionId: REVISION_A,
        status: "PLANNED",
      },
      [REVISION_B]: {
        cancelledStaleCount: 0,
        code: "NEWER_REVISION_EXISTS",
        revisionId: REVISION_B,
        status: "REJECTED",
      },
      [REVISION_C]: { revisionId: REVISION_C, status: "NOT_FOUND" },
    });

    const result = await runDateChangePlanningSweep({ dependencies: deps, now: NOW });

    assert.deepEqual(result, {
      cancelledStale: 1,
      created: 3,
      ignored: 0,
      notFound: 1,
      planned: 1,
      rejected: 1,
      revisions: 3,
    });
    assert.deepEqual(
      deps.planned.map(({ revisionId }) => revisionId),
      [REVISION_A, REVISION_B, REVISION_C],
    );
    assert.ok(deps.planned.every(({ now }) => now.getTime() === NOW.getTime()));
  });

  it("counts immaterial revisions as ignored, not failures", async () => {
    const deps = dependencies([REVISION_A], {
      [REVISION_A]: {
        cancelledStaleCount: 0,
        code: "NOT_MATERIAL",
        revisionId: REVISION_A,
        status: "IGNORED",
      },
    });

    const result = await runDateChangePlanningSweep({ dependencies: deps, now: NOW });

    assert.equal(result.ignored, 1);
    assert.equal(result.rejected, 0);
    assert.equal(result.planned, 0);
  });

  it("passes the lookback boundary derived from the sweep clock", async () => {
    let observedSince: Date | null = null;
    const deps: DateChangePlanningSweepDependencies = {
      listApprovedRevisionIds: (reviewedSince) => {
        observedSince = reviewedSince;
        return Promise.resolve([]);
      },
      plan: () => {
        throw new Error("nothing to plan");
      },
    };

    const result = await runDateChangePlanningSweep({
      dependencies: deps,
      lookbackMs: 60_000,
      now: NOW,
    });

    assert.equal(result.revisions, 0);
    assert.equal(observedSince!.getTime(), NOW.getTime() - 60_000);
  });

  it("rejects invalid limits and lookbacks", async () => {
    await assert.rejects(runDateChangePlanningSweep({ limit: 0, now: NOW }), RangeError);
    await assert.rejects(runDateChangePlanningSweep({ lookbackMs: -1, now: NOW }), RangeError);
  });
});
