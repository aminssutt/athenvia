import { createCanonicalFieldRevision, database } from "@athenvia/database";

import type { FetchableSource } from "./fetch-processor";
import type { ParseableSnapshot, ProposedRevision } from "./parse-processor";
import type { RecheckableSource } from "./recheck-sweep";
import type { ReviewableRevision } from "./review-processor";

export async function loadFetchableSource(sourceId: string): Promise<FetchableSource | null> {
  const source = await database.source.findUnique({
    where: { id: sourceId },
    select: {
      id: true,
      url: true,
      isOfficial: true,
      contentHash: true,
      university: { select: { officialDomain: true } },
      program: { select: { university: { select: { officialDomain: true } } } },
    },
  });
  if (!source) {
    return null;
  }
  return {
    id: source.id,
    url: source.url,
    isOfficial: source.isOfficial,
    contentHash: source.contentHash,
    universityOfficialDomain:
      source.university?.officialDomain ?? source.program?.university.officialDomain ?? null,
  };
}

export async function recordSourceCheck(
  sourceId: string,
  checkedAt: Date,
  httpStatus: number | null,
): Promise<void> {
  await database.source.updateMany({
    where: { id: sourceId },
    data: { httpStatus, lastCheckedAt: checkedAt },
  });
}

export async function loadParseableSnapshot(
  sourceSnapshotId: string,
): Promise<ParseableSnapshot | null> {
  const snapshot = await database.sourceSnapshot.findUnique({
    where: { id: sourceSnapshotId },
    select: {
      id: true,
      sourceId: true,
      storageKey: true,
      source: {
        select: {
          program: {
            select: {
              university: { select: { countryCode: true } },
              intakes: {
                select: {
                  id: true,
                  year: true,
                  month: true,
                  startDate: true,
                  applicationWindows: {
                    select: { id: true, roundName: true, opensAt: true, closesAt: true },
                    orderBy: { createdAt: "asc" },
                  },
                },
                orderBy: [{ year: "asc" }, { month: "asc" }],
              },
            },
          },
        },
      },
    },
  });
  if (!snapshot) {
    return null;
  }
  return {
    id: snapshot.id,
    sourceId: snapshot.sourceId,
    storageKey: snapshot.storageKey,
    universityCountryCode: snapshot.source.program?.university.countryCode ?? null,
    intakes: snapshot.source.program?.intakes ?? [],
  };
}

export async function createWindowRevision(
  snapshot: ParseableSnapshot,
  proposal: ProposedRevision,
): Promise<{ outcome: "CONFLICT" | "PENDING" | "UNCHANGED"; revisionId: string | null }> {
  const result = await createCanonicalFieldRevision(database, {
    creator: { kind: "WORKER" },
    currentValue: proposal.currentValue,
    entityId: proposal.entityId,
    entityType: "APPLICATION_WINDOW",
    fieldName: proposal.fieldName,
    proposedValue: proposal.proposedValue,
    sourceId: snapshot.sourceId,
    sourceSnapshotId: snapshot.id,
  });
  return { outcome: result.outcome, revisionId: result.revisionId };
}

export async function loadReviewableRevision(
  revisionId: string,
): Promise<ReviewableRevision | null> {
  return database.dataRevision.findUnique({
    where: { id: revisionId },
    select: {
      id: true,
      changeStatus: true,
      entityType: true,
      fieldName: true,
      hasConflict: true,
    },
  });
}

export async function findStaleOfficialSources(
  checkedBefore: Date,
  limit: number,
): Promise<RecheckableSource[]> {
  return database.source.findMany({
    where: {
      isOfficial: true,
      programId: { not: null },
      OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: checkedBefore } }],
    },
    orderBy: [{ lastCheckedAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
    take: limit,
    select: { id: true },
  });
}
