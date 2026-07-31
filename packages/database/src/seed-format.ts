import { readFile } from "node:fs/promises";

import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";

import { normalizeCatalogueName } from "./catalogue-normalization";

export const SEED_SCHEMA_VERSION = 1 as const;

export type SeedSource = {
  key: string;
  url: string;
  sourceType:
    "PROGRAM_PAGE" | "ADMISSIONS_PAGE" | "APPLICATION_PORTAL" | "OFFICIAL_PDF" | "UNIVERSITY_PAGE";
  isOfficial: true;
  lastCheckedAt: string;
};

export type SeedApplicationWindow = {
  key: string;
  roundName: string | null;
  opensAt: string | null;
  closesAt: string | null;
  publicStatus: "CONFIRMED" | "EXPECTED" | "NOT_PUBLISHED";
  verification: "OFFICIAL" | "VERIFIED" | "EXPECTED" | "UNKNOWN";
  sourceKey: string;
  lastVerifiedAt: string;
};

export type SeedIntake = {
  key: string;
  year: number;
  month: number;
  status: "PLANNED" | "OPEN" | "CLOSED" | "COMPLETED" | "UNKNOWN";
  applicationWindows: SeedApplicationWindow[];
};

export type SeedProgram = {
  key: string;
  name: string;
  degreeType: "MASTER" | "MBA" | "PHD" | "OTHER";
  summary: { text: string; sourceKey: string };
  durationMonths: number | null;
  campus: string | null;
  language: string | null;
  officialUrl: string;
  domains: string[];
  sources: SeedSource[];
  intakes: SeedIntake[];
};

export type SeedUniversity = {
  key: string;
  name: string;
  countryCode: string;
  city: string | null;
  officialDomain: string;
  officialWebsite: string;
  aliases: string[];
  programs: SeedProgram[];
};

export type SeedFile = {
  $schema?: string;
  schemaVersion: typeof SEED_SCHEMA_VERSION;
  domains: Array<{ slug: string; name: string }>;
  universities: SeedUniversity[];
};

export class SeedValidationError extends Error {
  constructor(
    readonly source: string,
    readonly issues: readonly string[],
  ) {
    super(`Invalid Athenvia seed ${source}:\n${issues.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "SeedValidationError";
  }
}

const EXACT_UTC_INSTANT =
  /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{3})?Z$/u;

let validatorPromise: Promise<ValidateFunction<SeedFile>> | undefined;

async function seedValidator(): Promise<ValidateFunction<SeedFile>> {
  validatorPromise ??= (async () => {
    const schemaUrl = new URL("../../../data/seed/seed.schema.json", import.meta.url);
    const schema = JSON.parse(await readFile(schemaUrl, "utf8")) as object;
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    return ajv.compile<SeedFile>(schema);
  })();
  return validatorPromise;
}

function formatSchemaIssue(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `${location} ${error.message ?? "is invalid"}`;
}

function addDuplicateIssues(
  values: readonly string[],
  path: string,
  issues: string[],
  normalize: (value: string) => string = (value) => value,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const comparable = normalize(value);
    if (seen.has(comparable)) {
      issues.push(`${path} contains duplicate value "${value}"`);
    }
    seen.add(comparable);
  }
}

function assertHttpsUrl(value: string, path: string, issues: string[]): void {
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      !parsed.hostname
    ) {
      issues.push(`${path} must be a credential-free HTTPS URL without a fragment`);
    }
  } catch {
    issues.push(`${path} must be a valid HTTPS URL`);
  }
}

function assertUtcInstant(value: string, path: string, issues: string[]): void {
  if (!EXACT_UTC_INSTANT.test(value) || !Number.isFinite(Date.parse(value))) {
    issues.push(`${path} must be an exact RFC 3339 UTC instant`);
  }
}

function collectSemanticIssues(seed: SeedFile): string[] {
  const issues: string[] = [];
  const domainSlugs = new Set(seed.domains.map(({ slug }) => slug));
  addDuplicateIssues(
    seed.domains.map(({ slug }) => slug),
    "/domains",
    issues,
  );
  addDuplicateIssues(
    seed.universities.map(({ key }) => key),
    "/universities",
    issues,
  );
  addDuplicateIssues(
    seed.universities.map(({ countryCode, name }) => `${countryCode}:${name}`),
    "/universities natural identities",
    issues,
    normalizeCatalogueName,
  );

  seed.universities.forEach((university, universityIndex) => {
    const universityPath = `/universities/${universityIndex}`;
    assertHttpsUrl(university.officialWebsite, `${universityPath}/officialWebsite`, issues);
    addDuplicateIssues(
      university.aliases,
      `${universityPath}/aliases`,
      issues,
      normalizeCatalogueName,
    );
    addDuplicateIssues(
      university.programs.map(({ key }) => key),
      `${universityPath}/programs`,
      issues,
    );
    addDuplicateIssues(
      university.programs.map(
        ({ degreeType, name }) => `${degreeType}:${normalizeCatalogueName(name)}`,
      ),
      `${universityPath}/programs natural identities`,
      issues,
    );

    university.programs.forEach((program, programIndex) => {
      const programPath = `${universityPath}/programs/${programIndex}`;
      assertHttpsUrl(program.officialUrl, `${programPath}/officialUrl`, issues);
      addDuplicateIssues(
        program.sources.map(({ key }) => key),
        `${programPath}/sources`,
        issues,
      );
      addDuplicateIssues(
        program.sources.map(({ url }) => url),
        `${programPath}/sources URLs`,
        issues,
        (url) => new URL(url).toString(),
      );
      addDuplicateIssues(
        program.intakes.map(({ key }) => key),
        `${programPath}/intakes`,
        issues,
      );

      for (const domain of program.domains) {
        if (!domainSlugs.has(domain)) {
          issues.push(`${programPath}/domains references unknown domain "${domain}"`);
        }
      }

      const sourcesByKey = new Map(program.sources.map((source) => [source.key, source]));
      for (const [sourceIndex, source] of program.sources.entries()) {
        const sourcePath = `${programPath}/sources/${sourceIndex}`;
        assertHttpsUrl(source.url, `${sourcePath}/url`, issues);
        assertUtcInstant(source.lastCheckedAt, `${sourcePath}/lastCheckedAt`, issues);
      }
      if (!sourcesByKey.has(program.summary.sourceKey)) {
        issues.push(
          `${programPath}/summary/sourceKey references unknown source "${program.summary.sourceKey}"`,
        );
      }

      program.intakes.forEach((intake, intakeIndex) => {
        const intakePath = `${programPath}/intakes/${intakeIndex}`;
        addDuplicateIssues(
          intake.applicationWindows.map(({ key }) => key),
          `${intakePath}/applicationWindows`,
          issues,
        );
        intake.applicationWindows.forEach((window, windowIndex) => {
          const windowPath = `${intakePath}/applicationWindows/${windowIndex}`;
          const source = sourcesByKey.get(window.sourceKey);
          if (!source) {
            issues.push(`${windowPath}/sourceKey references unknown source "${window.sourceKey}"`);
          }
          assertUtcInstant(window.lastVerifiedAt, `${windowPath}/lastVerifiedAt`, issues);
          if (source && Date.parse(window.lastVerifiedAt) > Date.parse(source.lastCheckedAt)) {
            issues.push(
              `${windowPath}/lastVerifiedAt cannot be later than its source lastCheckedAt`,
            );
          }
          if (window.opensAt) {
            assertUtcInstant(window.opensAt, `${windowPath}/opensAt`, issues);
          }
          if (window.closesAt) {
            assertUtcInstant(window.closesAt, `${windowPath}/closesAt`, issues);
          }

          const hasOpening = window.opensAt !== null;
          const hasDeadline = window.closesAt !== null;
          if (window.publicStatus === "CONFIRMED") {
            // Universities publish deadlines; they almost never publish an
            // exact opening instant. Requiring both discarded the exact,
            // officially sourced deadline students actually act on, so one
            // confirmed instant is enough and a null field simply reads as
            // "not published yet".
            if (!hasOpening && !hasDeadline) {
              issues.push(
                `${windowPath} CONFIRMED requires at least one exact instant, normally closesAt`,
              );
            }
            if (window.verification !== "OFFICIAL" && window.verification !== "VERIFIED") {
              issues.push(`${windowPath} CONFIRMED requires OFFICIAL or VERIFIED verification`);
            }
          } else if (hasOpening || hasDeadline) {
            issues.push(
              `${windowPath} ${window.publicStatus} cannot carry an unsupported exact date`,
            );
          }
          if (window.publicStatus === "EXPECTED" && window.verification !== "EXPECTED") {
            issues.push(`${windowPath} EXPECTED requires EXPECTED verification`);
          }
          if (
            window.publicStatus === "NOT_PUBLISHED" &&
            window.verification !== "OFFICIAL" &&
            window.verification !== "VERIFIED"
          ) {
            issues.push(`${windowPath} NOT_PUBLISHED requires OFFICIAL or VERIFIED verification`);
          }
          if (
            window.opensAt &&
            window.closesAt &&
            Date.parse(window.opensAt) >= Date.parse(window.closesAt)
          ) {
            issues.push(`${windowPath} opensAt must be earlier than closesAt`);
          }
        });
      });
    });
  });

  return issues;
}

export async function parseSeedJson(contents: string, source = "<memory>"): Promise<SeedFile> {
  let candidate: unknown;
  try {
    candidate = JSON.parse(contents);
  } catch {
    throw new SeedValidationError(source, ["file is not valid JSON"]);
  }

  const validate = await seedValidator();
  if (!validate(candidate)) {
    throw new SeedValidationError(
      source,
      (validate.errors ?? []).map((error) => formatSchemaIssue(error)),
    );
  }
  const semanticIssues = collectSemanticIssues(candidate);
  if (semanticIssues.length > 0) {
    throw new SeedValidationError(source, semanticIssues);
  }
  return candidate;
}

export async function readSeedFile(url: URL): Promise<SeedFile> {
  return parseSeedJson(await readFile(url, "utf8"), url.pathname);
}
