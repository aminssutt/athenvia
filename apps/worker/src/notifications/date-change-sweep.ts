import { database } from "@athenvia/database";

import { planDateChangeNotifications } from "./date-change-notifications";

import type { DateChangePlanningRepositoryResult } from "./date-change-notifications";

const DEFAULT_LOOKBACK_MS = 48 * 60 * 60_000;
const DEFAULT_REVISION_LIMIT = 200;

export interface DateChangePlanningSweepDependencies {
  listApprovedRevisionIds: (reviewedSince: Date, limit: number) => Promise<string[]>;
  plan: (revisionId: string, now: Date) => Promise<DateChangePlanningRepositoryResult>;
}

export interface DateChangePlanningSweepOptions {
  dependencies?: DateChangePlanningSweepDependencies;
  limit?: number;
  lookbackMs?: number;
  now?: Date;
}

export interface DateChangePlanningSweepResult {
  cancelledStale: number;
  created: number;
  ignored: number;
  notFound: number;
  planned: number;
  rejected: number;
  revisions: number;
}

export async function listApprovedWindowRevisionIds(
  reviewedSince: Date,
  limit: number,
): Promise<string[]> {
  const revisions = await database.dataRevision.findMany({
    where: {
      changeStatus: "APPROVED",
      entityType: "APPLICATION_WINDOW",
      fieldName: { in: ["closesAt", "opensAt"] },
      reviewedAt: { gte: reviewedSince },
    },
    orderBy: [{ reviewedAt: "asc" }, { id: "asc" }],
    select: { id: true },
    take: limit,
  });
  return revisions.map(({ id }) => id);
}

const defaultDependencies: DateChangePlanningSweepDependencies = {
  listApprovedRevisionIds: listApprovedWindowRevisionIds,
  plan: (revisionId, now) => planDateChangeNotifications(revisionId, { now }),
};

/**
 * Plans DATE_CHANGED push deliveries for recently approved application-window
 * revisions. The admin approval happens in the web app, which cannot reach
 * this planner, so the worker re-scans a bounded lookback window instead.
 * Replanning an already-planned revision is a no-op: deliveries carry a
 * deterministic dedupe key and superseded revisions are rejected by the
 * planner itself.
 */
export async function runDateChangePlanningSweep(
  options: DateChangePlanningSweepOptions = {},
): Promise<DateChangePlanningSweepResult> {
  const dependencies = options.dependencies ?? defaultDependencies;
  const lookbackMs = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const limit = options.limit ?? DEFAULT_REVISION_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("Date-change sweep limit must be an integer between 1 and 1000.");
  }
  if (!Number.isFinite(lookbackMs) || lookbackMs <= 0) {
    throw new RangeError("Date-change sweep lookback must be a positive duration.");
  }
  const now = options.now ?? new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new RangeError("Date-change sweep requires a valid clock.");
  }

  const result: DateChangePlanningSweepResult = {
    cancelledStale: 0,
    created: 0,
    ignored: 0,
    notFound: 0,
    planned: 0,
    rejected: 0,
    revisions: 0,
  };
  const revisionIds = await dependencies.listApprovedRevisionIds(
    new Date(now.getTime() - lookbackMs),
    limit,
  );
  for (const revisionId of revisionIds) {
    result.revisions += 1;
    const planning = await dependencies.plan(revisionId, now);
    if (planning.status === "NOT_FOUND") {
      result.notFound += 1;
      continue;
    }
    result.cancelledStale += planning.cancelledStaleCount;
    if (planning.status === "PLANNED") {
      result.planned += 1;
      result.created += planning.createdCount;
    } else if (planning.status === "IGNORED") {
      result.ignored += 1;
    } else {
      result.rejected += 1;
    }
  }
  return result;
}
