import { EntityStatus, type DegreeType, type Prisma } from "@prisma/client";

import {
  catalogueNameSimilarity,
  normalizeCatalogueName,
  normalizeOfficialDomain,
  normalizeOfficialUrl,
} from "./catalogue-normalization";
import { database } from "./client";

const LIKELY_DUPLICATE_THRESHOLD = 0.78;
export const DUPLICATE_REVIEW_FIELD = "duplicate_candidates";

export type DuplicateMatchReason =
  "normalized-alias" | "normalized-name" | "official-domain" | "official-url" | "similar-name";

export type DuplicateCandidate = {
  id: string;
  name: string;
  reasons: readonly DuplicateMatchReason[];
  score: number;
};

export type UniversityDuplicateInput = {
  countryCode: string;
  name: string;
  officialWebsite?: string | null;
};

export type UniversityDuplicateRecord = {
  aliases: readonly { alias: string }[];
  countryCode: string;
  id: string;
  name: string;
  officialDomain: string | null;
  officialWebsite: string | null;
};

export type ProgramDuplicateInput = {
  degreeType: DegreeType;
  name: string;
  officialUrl?: string | null;
  universityId: string;
};

export type ProgramDuplicateRecord = {
  degreeType: DegreeType;
  id: string;
  name: string;
  officialUrl: string | null;
  universityId: string;
};

type DuplicateReadClient = Pick<Prisma.TransactionClient, "program" | "university">;
type ReviewWriteClient = Pick<Prisma.TransactionClient, "dataRevision">;

function rankedCandidate(
  id: string,
  name: string,
  reasons: DuplicateMatchReason[],
  similarity: number,
): DuplicateCandidate | null {
  if (reasons.length === 0 && similarity < LIKELY_DUPLICATE_THRESHOLD) {
    return null;
  }
  const uniqueReasons = [...new Set(reasons)];
  if (similarity >= LIKELY_DUPLICATE_THRESHOLD && !uniqueReasons.includes("similar-name")) {
    uniqueReasons.push("similar-name");
  }

  return Object.freeze({
    id,
    name,
    reasons: Object.freeze(uniqueReasons),
    score: Math.max(
      similarity,
      uniqueReasons.includes("official-domain") ? 1 : 0,
      uniqueReasons.includes("official-url") ? 1 : 0,
      uniqueReasons.includes("normalized-name") ? 1 : 0,
      uniqueReasons.includes("normalized-alias") ? 0.99 : 0,
    ),
  });
}

function stableCandidates(candidates: Array<DuplicateCandidate | null>): DuplicateCandidate[] {
  return candidates
    .filter((candidate): candidate is DuplicateCandidate => candidate !== null)
    .sort((left, right) => {
      const scoreOrder = right.score - left.score;
      if (scoreOrder !== 0) {
        return scoreOrder;
      }
      const leftName = normalizeCatalogueName(left.name);
      const rightName = normalizeCatalogueName(right.name);
      if (leftName !== rightName) {
        return leftName < rightName ? -1 : 1;
      }
      return left.id < right.id ? -1 : Number(left.id > right.id);
    });
}

export function detectUniversityDuplicateCandidates(
  input: UniversityDuplicateInput,
  records: readonly UniversityDuplicateRecord[],
): DuplicateCandidate[] {
  const normalizedInput = normalizeCatalogueName(input.name);
  const submittedDomain = normalizeOfficialDomain(input.officialWebsite);

  return stableCandidates(
    records.map((record) => {
      const normalizedName = normalizeCatalogueName(record.name);
      const normalizedAliases = record.aliases.map(({ alias }) => normalizeCatalogueName(alias));
      const reasons: DuplicateMatchReason[] = [];
      if (record.countryCode === input.countryCode && normalizedName === normalizedInput) {
        reasons.push("normalized-name");
      }
      if (record.countryCode === input.countryCode && normalizedAliases.includes(normalizedInput)) {
        reasons.push("normalized-alias");
      }
      const recordDomains = [
        normalizeOfficialDomain(record.officialDomain),
        normalizeOfficialDomain(record.officialWebsite),
      ].filter((domain): domain is string => domain !== null);
      if (submittedDomain && recordDomains.includes(submittedDomain)) {
        reasons.push("official-domain");
      }

      const similarity =
        record.countryCode === input.countryCode
          ? Math.max(
              catalogueNameSimilarity(input.name, record.name),
              ...record.aliases.map(({ alias }) => catalogueNameSimilarity(input.name, alias)),
            )
          : 0;
      return rankedCandidate(record.id, record.name, reasons, similarity);
    }),
  );
}

export function detectProgramDuplicateCandidates(
  input: ProgramDuplicateInput,
  records: readonly ProgramDuplicateRecord[],
): DuplicateCandidate[] {
  const normalizedInput = normalizeCatalogueName(input.name);
  const submittedUrl = normalizeOfficialUrl(input.officialUrl);

  return stableCandidates(
    records.map((record) => {
      if (record.universityId !== input.universityId || record.degreeType !== input.degreeType) {
        return null;
      }
      const reasons: DuplicateMatchReason[] = [];
      if (normalizeCatalogueName(record.name) === normalizedInput) {
        reasons.push("normalized-name");
      }
      if (submittedUrl && normalizeOfficialUrl(record.officialUrl) === submittedUrl) {
        reasons.push("official-url");
      }
      return rankedCandidate(
        record.id,
        record.name,
        reasons,
        catalogueNameSimilarity(input.name, record.name),
      );
    }),
  );
}

export async function findUniversityDuplicateCandidates(
  input: UniversityDuplicateInput,
  client: DuplicateReadClient = database,
): Promise<DuplicateCandidate[]> {
  const submittedDomain = normalizeOfficialDomain(input.officialWebsite);
  const records = await client.university.findMany({
    where: {
      status: { in: [EntityStatus.ACTIVE, EntityStatus.PENDING] },
      OR: [
        { countryCode: input.countryCode },
        ...(submittedDomain
          ? [
              { officialDomain: { contains: submittedDomain, mode: "insensitive" as const } },
              {
                officialWebsite: {
                  contains: submittedDomain,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    },
    orderBy: { id: "asc" },
    take: 1_000,
    select: {
      aliases: { select: { alias: true } },
      countryCode: true,
      id: true,
      name: true,
      officialDomain: true,
      officialWebsite: true,
    },
  });
  return detectUniversityDuplicateCandidates(input, records);
}

export async function findProgramDuplicateCandidates(
  input: ProgramDuplicateInput,
  client: DuplicateReadClient = database,
): Promise<DuplicateCandidate[]> {
  const records = await client.program.findMany({
    where: {
      universityId: input.universityId,
      degreeType: input.degreeType,
      status: { in: [EntityStatus.ACTIVE, EntityStatus.PENDING] },
    },
    orderBy: { id: "asc" },
    take: 1_000,
    select: {
      degreeType: true,
      id: true,
      name: true,
      officialUrl: true,
      universityId: true,
    },
  });
  return detectProgramDuplicateCandidates(input, records);
}

export async function createDuplicateReview(
  client: ReviewWriteClient,
  entityType: "PROGRAM_SUBMISSION" | "UNIVERSITY_SUBMISSION",
  submissionId: string,
  candidates: readonly DuplicateCandidate[],
): Promise<string | null> {
  if (candidates.length === 0) {
    return null;
  }

  const review = await client.dataRevision.create({
    data: {
      entityType,
      entityId: submissionId,
      fieldName: DUPLICATE_REVIEW_FIELD,
      newValue: {
        candidateIds: candidates.map(({ id }) => id),
        candidates: candidates.map(({ id, reasons, score }) => ({
          id,
          reasons: [...reasons],
          score,
        })),
        strategy: "catalogue-normalization-v1",
      },
      createdByWorker: true,
    },
    select: { id: true },
  });
  return review.id;
}
