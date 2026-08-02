import type { PrismaClient } from "@prisma/client";

import { normalizeCatalogueName, normalizeOfficialUrl } from "./catalogue-normalization";
import { stableSeedUuid } from "./seed-import";

const TMM_IMPORT_LOCK_KEY = "athenvia:tmm-registry-import:v1";
const TMM_IMPORT_TRANSACTION_TIMEOUT_MS = 15 * 60_000;
const DEFAULT_BATCH_SIZE = 1_000;
const MAXIMUM_PROGRAM_NAME_LENGTH = 200;

/**
 * Provenance marker for programmes sourced from the ministry's Trouver Mon
 * Master open dataset. The linked fiche is the university's own page, but the
 * historical recruitment dates in the dataset are never imported: a TMM
 * programme lands with a next-cycle intake and a NOT_PUBLISHED window until
 * the verification pipeline confirms real dates.
 */
export const TMM_SOURCE_TYPE = "PROGRAM_PAGE";

/** Ministry discipline labels mapped onto catalogue domains. */
const TMM_DOMAINS: readonly { match: string; slug: string; name: string }[] = [
  {
    match: "arts lettres langues",
    slug: "arts-humanities-languages",
    name: "Arts, Humanities & Languages",
  },
  {
    match: "droit economie gestion",
    slug: "law-economics-management",
    name: "Law, Economics & Management",
  },
  { match: "sciences humaines et sociales", slug: "social-sciences", name: "Social Sciences" },
  {
    match: "sciences technologies sante",
    slug: "science-technology-health",
    name: "Science, Technology & Health",
  },
];

export type TmmRecord = {
  annee?: string | null;
  etab_uai?: string | null;
  etab_nom?: string | null;
  etab_ville?: string | null;
  for_intitule?: string | null;
  parc_intitule?: string | null;
  for_dom?: string | null;
  for_lien_fiche?: string | null;
};

export type TmmProgramCandidate = {
  universityName: string;
  normalizedUniversityName: string;
  uai: string | null;
  city: string | null;
  programName: string;
  normalizedProgramName: string;
  officialUrl: string | null;
  domainSlug: string | null;
};

function titleCaseCity(value: string): string {
  return value
    .toLocaleLowerCase("fr-FR")
    .replace(/(^|[\s'-])(\p{Letter})/gu, (match) => match.toLocaleUpperCase("fr-FR"));
}

function safeHttpUrl(value: string | null | undefined): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }
  return normalizeOfficialUrl(candidate) ? candidate : null;
}

export function mapTmmRecord(record: TmmRecord): TmmProgramCandidate | null {
  const universityName = record.etab_nom?.trim();
  if (!universityName) {
    return null;
  }
  const normalizedUniversityName = normalizeCatalogueName(universityName);
  if (!normalizedUniversityName) {
    return null;
  }

  const mention = record.for_intitule?.trim() || null;
  const parcours = record.parc_intitule?.trim() || null;
  let programName =
    mention && parcours
      ? normalizeCatalogueName(mention) !== normalizeCatalogueName(parcours)
        ? `${mention} – ${parcours}`
        : mention
      : (parcours ?? mention);
  if (!programName) {
    return null;
  }
  if (programName.length > MAXIMUM_PROGRAM_NAME_LENGTH) {
    programName = `${programName.slice(0, MAXIMUM_PROGRAM_NAME_LENGTH - 1)}…`;
  }
  const normalizedProgramName = normalizeCatalogueName(programName);
  if (!normalizedProgramName) {
    return null;
  }

  const normalizedDomain = normalizeCatalogueName(record.for_dom ?? "");
  const domain = TMM_DOMAINS.find((entry) => normalizedDomain.startsWith(entry.match));

  return {
    universityName,
    normalizedUniversityName,
    uai: record.etab_uai?.trim() || null,
    city: record.etab_ville?.trim() ? titleCaseCity(record.etab_ville.trim()) : null,
    programName,
    normalizedProgramName,
    officialUrl: safeHttpUrl(record.for_lien_fiche),
    domainSlug: domain?.slug ?? null,
  };
}

export type ExistingFrenchUniversity = {
  id: string;
  normalizedName: string;
};

export type TmmImportPlan = {
  newUniversities: {
    id: string;
    name: string;
    normalizedName: string;
    city: string | null;
  }[];
  programs: {
    id: string;
    universityId: string;
    name: string;
    normalizedName: string;
    officialUrl: string | null;
    campus: string | null;
    domainSlug: string | null;
  }[];
  matchedUniversities: number;
  skippedDuplicates: number;
};

/**
 * TMM names French universities by their historical numbered identities while
 * ROR carries the current display names. Normalized matching cannot bridge
 * these, and fuzzy matching must never try: Paris-X and Paris-XII are
 * different universities with nearly identical trigrams. Every entry below was
 * verified by hand against the catalogue; the key is the normalized TMM name,
 * the value the canonical display name as imported from ROR.
 */
export const TMM_UNIVERSITY_VARIANTS: ReadonlyMap<string, string> = new Map([
  ["universite sorbonne universite", "Sorbonne Université"],
  ["universite paris i", "Université Paris 1 Panthéon-Sorbonne"],
  ["universite paris ii", "Université Paris-Panthéon-Assas"],
  ["universite paris viii", "Université Paris 8"],
  ["universite paris x", "Université Paris Nanterre"],
  ["universite paris xii", "Université Paris-Est Créteil"],
  ["universite paris xiii", "Université Sorbonne Paris Nord"],
  ["universite rennes i", "Université de Rennes"],
  ["universite rennes ii", "Université Rennes 2"],
  ["universite toulouse i", "Université Toulouse Capitole"],
  ["universite toulouse ii", "Université Toulouse - Jean Jaurès"],
  ["universite lyon iii", "Université Jean Moulin Lyon III"],
  ["universite montpellier iii", "Université de Montpellier Paul-Valéry"],
  ["universite bordeaux iii", "Université Bordeaux Montaigne"],
  ["universite d amiens", "Université de Picardie Jules Verne"],
  ["universite de dijon", "Université Bourgogne Europe"],
  ["universite de reims", "Université de Reims Champagne-Ardenne"],
  ["universite de pau", "Université de Pau et des Pays de l'Adour"],
  ["universite du mans", "Le Mans Université"],
  ["universite de mulhouse", "Université de Haute-Alsace"],
  ["universite du littoral", "Université du littoral côte d'opale"],
  ["universite d avignon", "Université d'Avignon et des Pays de Vaucluse"],
]);

export function canonicalNormalizedUniversityName(normalizedName: string): string {
  const canonicalDisplay = TMM_UNIVERSITY_VARIANTS.get(normalizedName);
  return canonicalDisplay ? normalizeCatalogueName(canonicalDisplay) : normalizedName;
}

/**
 * Universities are matched onto the existing catalogue by normalized name or
 * alias within France; unmatched establishments are created. Programmes are
 * deduplicated on their (university, normalized name) natural key.
 */
export function planTmmImport(
  candidates: readonly TmmProgramCandidate[],
  existingUniversities: readonly ExistingFrenchUniversity[],
  aliasIndex: ReadonlyMap<string, string>,
): TmmImportPlan {
  const byName = new Map(existingUniversities.map((u) => [u.normalizedName, u.id]));
  const newUniversities = new Map<string, TmmImportPlan["newUniversities"][number]>();
  const programs = new Map<string, TmmImportPlan["programs"][number]>();
  const matched = new Set<string>();
  let skippedDuplicates = 0;

  const ordered = [...candidates].sort(
    (left, right) =>
      left.normalizedUniversityName.localeCompare(right.normalizedUniversityName, "en") ||
      left.normalizedProgramName.localeCompare(right.normalizedProgramName, "en"),
  );

  for (const candidate of ordered) {
    const lookupName = canonicalNormalizedUniversityName(candidate.normalizedUniversityName);
    let universityId = byName.get(lookupName) ?? aliasIndex.get(lookupName);
    if (universityId) {
      matched.add(universityId);
    } else {
      const identity = `tmm:university:${candidate.uai ?? candidate.normalizedUniversityName}`;
      universityId = stableSeedUuid(identity);
      if (!newUniversities.has(universityId)) {
        newUniversities.set(universityId, {
          id: universityId,
          name: candidate.universityName,
          normalizedName: candidate.normalizedUniversityName,
          city: candidate.city,
        });
      }
      byName.set(lookupName, universityId);
    }

    const programKey = `${universityId}|${candidate.normalizedProgramName}`;
    if (programs.has(programKey)) {
      skippedDuplicates += 1;
      continue;
    }
    programs.set(programKey, {
      id: stableSeedUuid(`tmm:program:${universityId}:${candidate.normalizedProgramName}`),
      universityId,
      name: candidate.programName,
      normalizedName: candidate.normalizedProgramName,
      officialUrl: candidate.officialUrl,
      campus: candidate.city,
      domainSlug: candidate.domainSlug,
    });
  }

  return {
    newUniversities: [...newUniversities.values()],
    programs: [...programs.values()],
    matchedUniversities: matched.size,
    skippedDuplicates,
  };
}

function* chunks<T>(items: readonly T[], size: number): Generator<readonly T[]> {
  for (let index = 0; index < items.length; index += size) {
    yield items.slice(index, index + size);
  }
}

export type TmmImportOptions = {
  /** September intake year the imported programmes point at. */
  intakeYear: number;
  batchSize?: number;
  checkedAt?: Date;
};

export type TmmImportCounts = {
  scanned: number;
  eligible: number;
  matchedUniversities: number;
  createdUniversities: number;
  createdPrograms: number;
  createdIntakes: number;
  createdWindows: number;
  createdSources: number;
  skippedDuplicates: number;
};

/**
 * Imports TMM records inside one advisory-locked transaction. Deterministic
 * identities plus createMany skipDuplicates make re-runs idempotent, exactly
 * like the ROR importer. Historical recruitment dates are never written:
 * every window lands NOT_PUBLISHED with no instants.
 */
export async function importTmmRecords(
  database: PrismaClient,
  records: readonly TmmRecord[],
  options: TmmImportOptions,
): Promise<TmmImportCounts> {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const checkedAt = options.checkedAt ?? new Date();
  const candidates: TmmProgramCandidate[] = [];
  for (const record of records) {
    const candidate = mapTmmRecord(record);
    if (candidate) {
      candidates.push(candidate);
    }
  }

  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${TMM_IMPORT_LOCK_KEY}, 0))`;

      const existing = await transaction.university.findMany({
        where: { countryCode: "FR" },
        select: { id: true, normalizedName: true },
      });
      const aliases = await transaction.universityAlias.findMany({
        where: { university: { countryCode: "FR" } },
        select: { normalizedAlias: true, universityId: true },
      });
      const aliasIndex = new Map(aliases.map((a) => [a.normalizedAlias, a.universityId]));
      const plan = planTmmImport(candidates, existing, aliasIndex);

      let createdUniversities = 0;
      for (const batch of chunks(plan.newUniversities, batchSize)) {
        const result = await transaction.university.createMany({
          data: batch.map((university) => ({
            id: university.id,
            name: university.name,
            normalizedName: university.normalizedName,
            countryCode: "FR",
            city: university.city,
            status: "ACTIVE",
          })),
          skipDuplicates: true,
        });
        createdUniversities += result.count;
      }

      const domainIds = new Map<string, string>();
      for (const domain of TMM_DOMAINS) {
        const id = stableSeedUuid(`domain:${domain.slug}`);
        await transaction.domain.upsert({
          where: { slug: domain.slug },
          create: { id, slug: domain.slug, name: domain.name },
          update: {},
        });
        const row = await transaction.domain.findUniqueOrThrow({
          where: { slug: domain.slug },
          select: { id: true },
        });
        domainIds.set(domain.slug, row.id);
      }

      let createdPrograms = 0;
      for (const batch of chunks(plan.programs, batchSize)) {
        const result = await transaction.program.createMany({
          data: batch.map((program) => ({
            id: program.id,
            universityId: program.universityId,
            name: program.name,
            normalizedName: program.normalizedName,
            degreeType: "MASTER",
            campus: program.campus,
            officialUrl: program.officialUrl,
            status: "ACTIVE",
          })),
          skipDuplicates: true,
        });
        createdPrograms += result.count;
      }

      // A programme may already exist under its natural key with a different
      // identity — notably after a duplicate-university merge. Everything that
      // references programmes must use the identities actually in the table.
      const storedPrograms = await transaction.program.findMany({
        where: {
          universityId: { in: [...new Set(plan.programs.map((p) => p.universityId))] },
          degreeType: "MASTER",
        },
        select: { id: true, universityId: true, normalizedName: true },
      });
      const realProgramIds = new Map(
        storedPrograms.map((p) => [`${p.universityId}|${p.normalizedName}`, p.id]),
      );
      const resolvedPrograms = plan.programs.flatMap((program) => {
        const realId = realProgramIds.get(`${program.universityId}|${program.normalizedName}`);
        return realId ? [{ ...program, id: realId }] : [];
      });

      const domainLinks = resolvedPrograms.flatMap((program) =>
        program.domainSlug && domainIds.has(program.domainSlug)
          ? [{ programId: program.id, domainId: domainIds.get(program.domainSlug)! }]
          : [],
      );
      for (const batch of chunks(domainLinks, batchSize)) {
        await transaction.programDomain.createMany({ data: [...batch], skipDuplicates: true });
      }

      let createdSources = 0;
      const sourceRows = resolvedPrograms.flatMap((program) =>
        program.officialUrl
          ? [
              {
                id: stableSeedUuid(`tmm:source:${program.id}`),
                programId: program.id,
                universityId: program.universityId,
                url: program.officialUrl,
                sourceType: TMM_SOURCE_TYPE,
                isOfficial: true,
                lastCheckedAt: checkedAt,
              },
            ]
          : [],
      );
      for (const batch of chunks(sourceRows, batchSize)) {
        const result = await transaction.source.createMany({
          data: [...batch],
          skipDuplicates: true,
        });
        createdSources += result.count;
      }

      let createdIntakes = 0;
      let createdWindows = 0;
      const intakeRows = resolvedPrograms.map((program) => ({
        id: stableSeedUuid(`tmm:intake:${program.id}:${options.intakeYear}-09`),
        programId: program.id,
        year: options.intakeYear,
        month: 9,
        status: "PLANNED" as const,
      }));
      for (const batch of chunks(intakeRows, batchSize)) {
        const result = await transaction.intake.createMany({
          data: [...batch],
          skipDuplicates: true,
        });
        createdIntakes += result.count;
      }
      const windowRows = intakeRows.map((intake) => ({
        id: stableSeedUuid(`tmm:window:${intake.id}`),
        intakeId: intake.id,
        publicStatus: "NOT_PUBLISHED" as const,
        verification: "UNKNOWN" as const,
      }));
      for (const batch of chunks(windowRows, batchSize)) {
        const result = await transaction.applicationWindow.createMany({
          data: [...batch],
          skipDuplicates: true,
        });
        createdWindows += result.count;
      }

      return {
        scanned: records.length,
        eligible: candidates.length,
        matchedUniversities: plan.matchedUniversities,
        createdUniversities,
        createdPrograms,
        createdIntakes,
        createdWindows,
        createdSources,
        skippedDuplicates: plan.skippedDuplicates,
      };
    },
    { timeout: TMM_IMPORT_TRANSACTION_TIMEOUT_MS },
  );
}

export type TmmRepairCounts = {
  mergedUniversities: number;
  movedPrograms: number;
  movedSources: number;
};

/**
 * Merges duplicate universities that an earlier import created before the
 * variant table existed: programmes and sources move onto the canonical
 * university, the variant name becomes an alias so any future import matches
 * directly, and the emptied duplicate is archived out of the public
 * catalogue. Idempotent — once a duplicate is archived and empty, a re-run
 * touches nothing.
 */
export async function repairTmmUniversityDuplicates(
  database: PrismaClient,
): Promise<TmmRepairCounts> {
  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${TMM_IMPORT_LOCK_KEY}, 0))`;
      let mergedUniversities = 0;
      let movedPrograms = 0;
      let movedSources = 0;

      for (const [variantNormalized, canonicalDisplay] of TMM_UNIVERSITY_VARIANTS) {
        const canonicalNormalized = normalizeCatalogueName(canonicalDisplay);
        const duplicate = await transaction.university.findFirst({
          where: { countryCode: "FR", normalizedName: variantNormalized, status: "ACTIVE" },
          select: { id: true, name: true },
        });
        const canonical = await transaction.university.findFirst({
          where: {
            countryCode: "FR",
            normalizedName: canonicalNormalized,
            status: "ACTIVE",
            id: { not: duplicate?.id ?? undefined },
          },
          select: { id: true },
        });
        if (!duplicate || !canonical) {
          continue;
        }

        const programs = await transaction.program.updateMany({
          where: { universityId: duplicate.id },
          data: { universityId: canonical.id },
        });
        const sources = await transaction.source.updateMany({
          where: { universityId: duplicate.id },
          data: { universityId: canonical.id },
        });
        await transaction.universityAlias.createMany({
          data: [
            {
              id: stableSeedUuid(`tmm:alias:${canonical.id}:${variantNormalized}`),
              universityId: canonical.id,
              alias: duplicate.name,
              normalizedAlias: variantNormalized,
            },
          ],
          skipDuplicates: true,
        });
        await transaction.university.update({
          where: { id: duplicate.id },
          data: { status: "ARCHIVED" },
        });

        mergedUniversities += 1;
        movedPrograms += programs.count;
        movedSources += sources.count;
      }

      return { mergedUniversities, movedPrograms, movedSources };
    },
    { timeout: TMM_IMPORT_TRANSACTION_TIMEOUT_MS },
  );
}
