import type { PrismaClient } from "@prisma/client";

import { normalizeCatalogueName, normalizeOfficialDomain } from "./catalogue-normalization";
import { stableSeedUuid } from "./seed-import";

const ROR_IMPORT_LOCK_KEY = "athenvia:ror-registry-import:v1";
const ROR_IMPORT_TRANSACTION_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_BATCH_SIZE = 1_000;

/**
 * Provenance marker for universities sourced from the Research Organization
 * Registry. ROR is a curated registry, not the university's own site, so its
 * sources are never official evidence for application dates.
 */
export const ROR_REGISTRY_SOURCE_TYPE = "REGISTRY";

export type RorName = {
  value: string;
  types: readonly string[];
  lang?: string | null;
};

export type RorLink = {
  type: string;
  value: string;
};

export type RorLocation = {
  geonames_details?: {
    country_code?: string | null;
    name?: string | null;
  };
};

/** Minimal shape of a ROR schema v2 record. Additional fields are ignored. */
export type RorRecord = {
  id: string;
  status: string;
  types: readonly string[];
  names: readonly RorName[];
  links?: readonly RorLink[];
  domains?: readonly string[];
  locations?: readonly RorLocation[];
};

export type RorAlias = {
  alias: string;
  normalizedAlias: string;
};

export type RorUniversityCandidate = {
  rorId: string;
  name: string;
  normalizedName: string;
  countryCode: string;
  city: string | null;
  officialDomain: string | null;
  officialWebsite: string | null;
  aliases: readonly RorAlias[];
};

export type ExistingUniversity = {
  id: string;
  normalizedName: string;
  countryCode: string;
  city: string | null;
  officialDomain: string | null;
  officialWebsite: string | null;
};

export type RorUniversityWrite = RorUniversityCandidate & { id: string };

export type RorAdoption = {
  universityId: string;
  candidate: RorUniversityCandidate;
  /** Only fields that are null on the curated record are ever filled in. */
  fill: {
    city?: string;
    officialDomain?: string;
    officialWebsite?: string;
  };
};

export type RorAliasWrite = {
  id: string;
  universityId: string;
  alias: string;
  normalizedAlias: string;
};

export type RorSourceWrite = {
  id: string;
  universityId: string;
  url: string;
};

export type RorImportPlan = {
  creates: readonly RorUniversityWrite[];
  adoptions: readonly RorAdoption[];
  aliases: readonly RorAliasWrite[];
  sources: readonly RorSourceWrite[];
  skippedDuplicates: number;
};

export type RorImportCounts = {
  scanned: number;
  eligible: number;
  skippedDuplicates: number;
  createdUniversities: number;
  adoptedUniversities: number;
  createdAliases: number;
  createdSources: number;
};

function candidateKey(normalizedName: string, countryCode: string): string {
  return `${normalizedName}|${countryCode}`;
}

function officialWebsite(record: RorRecord): string | null {
  const website = record.links?.find((link) => link.type === "website")?.value.trim();
  if (!website) {
    return null;
  }
  try {
    const url = new URL(website);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      return null;
    }
    return website;
  } catch {
    return null;
  }
}

/**
 * Maps one ROR record to an importable university. Returns null for records
 * outside the catalogue scope: inactive registrations, non-education
 * organizations and records without a display name or a country.
 */
export function mapRorRecord(record: RorRecord): RorUniversityCandidate | null {
  if (record.status !== "active" || !record.types.includes("education")) {
    return null;
  }

  const displayName = record.names.find((name) => name.types.includes("ror_display"))?.value.trim();
  if (!displayName) {
    return null;
  }
  const normalizedName = normalizeCatalogueName(displayName);
  if (!normalizedName) {
    return null;
  }

  const geonames = record.locations?.[0]?.geonames_details;
  const countryCode = geonames?.country_code?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{2}$/u.test(countryCode)) {
    return null;
  }

  const website = officialWebsite(record);
  const officialDomain =
    normalizeOfficialDomain(record.domains?.[0]) ?? normalizeOfficialDomain(website);

  const aliases = new Map<string, RorAlias>();
  for (const name of record.names) {
    if (name.types.includes("ror_display")) {
      continue;
    }
    const alias = name.value.trim();
    const normalizedAlias = normalizeCatalogueName(alias);
    if (!normalizedAlias || normalizedAlias === normalizedName || aliases.has(normalizedAlias)) {
      continue;
    }
    aliases.set(normalizedAlias, { alias, normalizedAlias });
  }

  return {
    rorId: record.id,
    name: displayName,
    normalizedName,
    countryCode,
    city: geonames?.name?.trim() || null,
    officialDomain,
    officialWebsite: website,
    aliases: [...aliases.values()],
  };
}

/**
 * Splits mapped candidates into new universities and adoptions of existing
 * records matched on the (normalizedName, countryCode) natural key. Curated
 * data always wins: an adoption only fills fields that are currently null and
 * never renames, moves or deactivates an existing university.
 */
export function planRorImport(
  candidates: readonly RorUniversityCandidate[],
  existing: readonly ExistingUniversity[],
): RorImportPlan {
  const existingByKey = new Map<string, ExistingUniversity>();
  for (const university of existing) {
    existingByKey.set(candidateKey(university.normalizedName, university.countryCode), university);
  }

  const creates: RorUniversityWrite[] = [];
  const adoptions: RorAdoption[] = [];
  const aliases: RorAliasWrite[] = [];
  const sources: RorSourceWrite[] = [];
  const seen = new Set<string>();
  let skippedDuplicates = 0;

  const orderedCandidates = [...candidates].sort((left, right) =>
    left.rorId.localeCompare(right.rorId, "en"),
  );

  for (const candidate of orderedCandidates) {
    const key = candidateKey(candidate.normalizedName, candidate.countryCode);
    if (seen.has(key)) {
      skippedDuplicates += 1;
      continue;
    }
    seen.add(key);

    const adopted = existingByKey.get(key);
    let universityId: string;
    if (adopted) {
      universityId = adopted.id;
      const fill: RorAdoption["fill"] = {};
      if (!adopted.city && candidate.city) {
        fill.city = candidate.city;
      }
      if (!adopted.officialDomain && candidate.officialDomain) {
        fill.officialDomain = candidate.officialDomain;
      }
      if (!adopted.officialWebsite && candidate.officialWebsite) {
        fill.officialWebsite = candidate.officialWebsite;
      }
      adoptions.push({ universityId, candidate, fill });
    } else {
      universityId = stableSeedUuid(`ror:university:${candidate.rorId}`);
      creates.push({ ...candidate, id: universityId });
    }

    for (const alias of candidate.aliases) {
      aliases.push({
        id: stableSeedUuid(`ror:alias:${universityId}:${alias.normalizedAlias}`),
        universityId,
        alias: alias.alias,
        normalizedAlias: alias.normalizedAlias,
      });
    }

    sources.push({
      id: stableSeedUuid(`ror:source:${universityId}`),
      universityId,
      url: candidate.rorId,
    });
  }

  return { creates, adoptions, aliases, sources, skippedDuplicates };
}

function* chunks<T>(items: readonly T[], size: number): Generator<readonly T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

export type RorImportOptions = {
  batchSize?: number;
  /** When the registry snapshot was published; recorded as lastCheckedAt. */
  checkedAt?: Date;
};

/**
 * Imports ROR records inside one advisory-locked transaction. Deterministic
 * identifiers plus createMany skipDuplicates make repeated and concurrent runs
 * idempotent: a re-run inserts nothing and reports zero created rows.
 */
export async function importRorRecords(
  database: PrismaClient,
  records: readonly RorRecord[],
  options: RorImportOptions = {},
): Promise<RorImportCounts> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const checkedAt = options.checkedAt ?? new Date();
  const candidates: RorUniversityCandidate[] = [];
  for (const record of records) {
    const candidate = mapRorRecord(record);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${ROR_IMPORT_LOCK_KEY}, 0))`;

      const existing = await transaction.university.findMany({
        select: {
          id: true,
          normalizedName: true,
          countryCode: true,
          city: true,
          officialDomain: true,
          officialWebsite: true,
        },
      });
      const plan = planRorImport(candidates, existing);

      let createdUniversities = 0;
      for (const batch of chunks(plan.creates, batchSize)) {
        const result = await transaction.university.createMany({
          data: batch.map((university) => ({
            id: university.id,
            name: university.name,
            normalizedName: university.normalizedName,
            countryCode: university.countryCode,
            city: university.city,
            officialDomain: university.officialDomain,
            officialWebsite: university.officialWebsite,
            status: "ACTIVE",
          })),
          skipDuplicates: true,
        });
        createdUniversities += result.count;
      }

      for (const adoption of plan.adoptions) {
        if (Object.keys(adoption.fill).length === 0) {
          continue;
        }
        await transaction.university.update({
          where: { id: adoption.universityId },
          data: adoption.fill,
        });
      }

      let createdAliases = 0;
      for (const batch of chunks(plan.aliases, batchSize)) {
        const result = await transaction.universityAlias.createMany({
          data: batch.map((alias) => ({
            id: alias.id,
            universityId: alias.universityId,
            alias: alias.alias,
            normalizedAlias: alias.normalizedAlias,
          })),
          skipDuplicates: true,
        });
        createdAliases += result.count;
      }

      let createdSources = 0;
      for (const batch of chunks(plan.sources, batchSize)) {
        const result = await transaction.source.createMany({
          data: batch.map((source) => ({
            id: source.id,
            universityId: source.universityId,
            url: source.url,
            sourceType: ROR_REGISTRY_SOURCE_TYPE,
            isOfficial: false,
            lastCheckedAt: checkedAt,
          })),
          skipDuplicates: true,
        });
        createdSources += result.count;
      }

      return {
        scanned: records.length,
        eligible: candidates.length,
        skippedDuplicates: plan.skippedDuplicates,
        createdUniversities,
        adoptedUniversities: plan.adoptions.length,
        createdAliases,
        createdSources,
      };
    },
    { timeout: ROR_IMPORT_TRANSACTION_TIMEOUT_MS },
  );
}
