import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { describe, it } from "node:test";

import { applySeedFile, stableSeedUuid, type SeedWriter } from "../src/seed-import";
import {
  parseSeedJson,
  readSeedFile,
  SeedValidationError,
  type SeedFile,
} from "../src/seed-format";

const sampleUrl = new URL("../../../data/seed/sample.json", import.meta.url);
const seedDirectoryUrl = new URL("../../../data/seed/", import.meta.url);

function copy(seed: SeedFile): SeedFile {
  return structuredClone(seed);
}

async function expectInvalid(seed: SeedFile, message: RegExp): Promise<void> {
  await assert.rejects(
    parseSeedJson(JSON.stringify(seed), "test-seed.json"),
    (error: unknown) =>
      error instanceof SeedValidationError && message.test(error.issues.join("\n")),
  );
}

class MemorySeedWriter implements SeedWriter {
  readonly applicationWindows = new Map<string, unknown>();
  readonly domains = new Map<string, unknown>();
  readonly intakes = new Map<string, unknown>();
  readonly programDomains = new Map<string, unknown>();
  readonly programs = new Map<string, unknown>();
  readonly programSummaries = new Map<string, unknown>();
  readonly sources = new Map<string, unknown>();
  readonly universityAliases = new Map<string, unknown>();
  readonly universities = new Map<string, unknown>();

  async upsertDomain(input: Parameters<SeedWriter["upsertDomain"]>[0]): Promise<string> {
    this.domains.set(input.slug, input);
    return input.id;
  }

  async upsertUniversity(input: Parameters<SeedWriter["upsertUniversity"]>[0]): Promise<string> {
    this.universities.set(input.id, input);
    return input.id;
  }

  async upsertUniversityAlias(
    input: Parameters<SeedWriter["upsertUniversityAlias"]>[0],
  ): Promise<void> {
    this.universityAliases.set(`${input.universityId}:${input.id}`, input);
  }

  async upsertProgram(input: Parameters<SeedWriter["upsertProgram"]>[0]): Promise<string> {
    this.programs.set(input.id, input);
    return input.id;
  }

  async connectProgramDomain(
    input: Parameters<SeedWriter["connectProgramDomain"]>[0],
  ): Promise<void> {
    this.programDomains.set(`${input.programId}:${input.domainId}`, input);
  }

  async upsertSource(input: Parameters<SeedWriter["upsertSource"]>[0]): Promise<string> {
    this.sources.set(input.id, input);
    return input.id;
  }

  async upsertProgramSummary(
    input: Parameters<SeedWriter["upsertProgramSummary"]>[0],
  ): Promise<void> {
    this.programSummaries.set(input.programId, input);
  }

  async upsertIntake(input: Parameters<SeedWriter["upsertIntake"]>[0]): Promise<string> {
    this.intakes.set(input.id, input);
    return input.id;
  }

  async upsertApplicationWindow(
    input: Parameters<SeedWriter["upsertApplicationWindow"]>[0],
  ): Promise<void> {
    this.applicationWindows.set(input.id, input);
  }

  sizes(): Record<string, number> {
    return {
      applicationWindows: this.applicationWindows.size,
      domains: this.domains.size,
      intakes: this.intakes.size,
      programDomains: this.programDomains.size,
      programs: this.programs.size,
      programSummaries: this.programSummaries.size,
      sources: this.sources.size,
      universityAliases: this.universityAliases.size,
      universities: this.universities.size,
    };
  }
}

describe("source-backed seed v1 validation", () => {
  it("validates every checked-in seed document for CI", async () => {
    const fileNames = (await readdir(seedDirectoryUrl))
      .filter((fileName) => fileName.endsWith(".json") && fileName !== "seed.schema.json")
      .sort((left, right) => left.localeCompare(right, "en"));

    assert.ok(fileNames.length > 0);
    for (const fileName of fileNames) {
      await readSeedFile(new URL(fileName, seedDirectoryUrl));
    }
  });

  it("accepts the checked-in sample and keeps every fact source-backed", async () => {
    const seed = await readSeedFile(sampleUrl);
    assert.equal(seed.schemaVersion, 1);
    assert.equal(seed.universities[0]?.programs[0]?.summary.sourceKey, "programme-page");
    assert.equal(
      seed.universities[0]?.programs[0]?.intakes[0]?.applicationWindows[0]?.publicStatus,
      "NOT_PUBLISHED",
    );
  });

  it("rejects unknown properties, unsafe source URLs and missing source references", async () => {
    const baseline = await readSeedFile(sampleUrl);

    const unknownProperty = copy(baseline) as SeedFile & { unexpected?: boolean };
    unknownProperty.unexpected = true;
    await expectInvalid(unknownProperty, /additional properties/u);

    const unsafeUrl = copy(baseline);
    unsafeUrl.universities[0]!.programs[0]!.sources[0]!.url =
      "https://user:secret@example.edu/program";
    await expectInvalid(unsafeUrl, /credential-free HTTPS URL/u);

    const missingSummarySource = copy(baseline);
    missingSummarySource.universities[0]!.programs[0]!.summary.sourceKey = "missing";
    await expectInvalid(missingSummarySource, /summary\/sourceKey references unknown/u);

    const missingWindowSource = copy(baseline);
    missingWindowSource.universities[0]!.programs[0]!.intakes[0]!.applicationWindows[0]!.sourceKey =
      "missing";
    await expectInvalid(missingWindowSource, /sourceKey references unknown/u);
  });

  it("rejects duplicate logical keys and invalid verification chronology", async () => {
    const baseline = await readSeedFile(sampleUrl);

    const duplicateSource = copy(baseline);
    duplicateSource.universities[0]!.programs[0]!.sources.push(
      structuredClone(duplicateSource.universities[0]!.programs[0]!.sources[0]!),
    );
    await expectInvalid(duplicateSource, /sources contains duplicate value/u);

    const duplicateCanonicalUrl = copy(baseline);
    const repeatedSource = structuredClone(
      duplicateCanonicalUrl.universities[0]!.programs[0]!.sources[0]!,
    );
    repeatedSource.key = "same-page";
    repeatedSource.url = repeatedSource.url.replace(/\/$/u, "");
    duplicateCanonicalUrl.universities[0]!.programs[0]!.sources.push(repeatedSource);
    await expectInvalid(duplicateCanonicalUrl, /sources URLs contains duplicate value/u);

    const futureVerification = copy(baseline);
    futureVerification.universities[0]!.programs[0]!.intakes[0]!.applicationWindows[0]!.lastVerifiedAt =
      "2026-07-31T00:00:00.000Z";
    await expectInvalid(futureVerification, /cannot be later/u);
  });

  it("enforces the one-status ApplicationWindow model without inventing dates", async () => {
    const baseline = await readSeedFile(sampleUrl);

    const partialConfirmed = copy(baseline);
    const partialWindow =
      partialConfirmed.universities[0]!.programs[0]!.intakes[0]!.applicationWindows[0]!;
    partialWindow.publicStatus = "CONFIRMED";
    partialWindow.opensAt = "2026-10-01T00:00:00.000Z";
    await expectInvalid(partialConfirmed, /requires both opensAt and closesAt/u);

    const exactExpected = copy(baseline);
    const expectedWindow =
      exactExpected.universities[0]!.programs[0]!.intakes[0]!.applicationWindows[0]!;
    expectedWindow.publicStatus = "EXPECTED";
    expectedWindow.verification = "EXPECTED";
    expectedWindow.opensAt = "2026-10-01T00:00:00.000Z";
    expectedWindow.closesAt = "2027-01-01T00:00:00.000Z";
    await expectInvalid(exactExpected, /cannot carry an unsupported exact date/u);

    const reversed = copy(baseline);
    const reversedWindow =
      reversed.universities[0]!.programs[0]!.intakes[0]!.applicationWindows[0]!;
    reversedWindow.publicStatus = "CONFIRMED";
    reversedWindow.verification = "OFFICIAL";
    reversedWindow.opensAt = "2027-01-02T00:00:00.000Z";
    reversedWindow.closesAt = "2027-01-01T00:00:00.000Z";
    reversedWindow.lastVerifiedAt = "2026-07-30T00:00:00.000Z";
    await expectInvalid(reversed, /opensAt must be earlier/u);
  });
});

describe("idempotent seed application", () => {
  it("derives stable UUID v5 identifiers", () => {
    const first = stableSeedUuid("university:nus:program:msc-venture-creation");
    assert.equal(first, stableSeedUuid("university:nus:program:msc-venture-creation"));
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    assert.notEqual(first, stableSeedUuid("university:nus:program:other"));
  });

  it("can apply the same document twice without duplicate records", async () => {
    const seed = await readSeedFile(sampleUrl);
    const writer = new MemorySeedWriter();

    const firstCounts = await applySeedFile(writer, seed);
    const firstSizes = writer.sizes();
    const secondCounts = await applySeedFile(writer, seed);

    assert.deepEqual(secondCounts, firstCounts);
    assert.deepEqual(writer.sizes(), firstSizes);
    assert.deepEqual(firstSizes, {
      applicationWindows: 1,
      domains: 2,
      intakes: 1,
      programDomains: 2,
      programs: 1,
      programSummaries: 1,
      sources: 1,
      universityAliases: 1,
      universities: 1,
    });
  });

  it("never prunes a prior relation when a later file omits it", async () => {
    const seed = await readSeedFile(sampleUrl);
    const writer = new MemorySeedWriter();
    await applySeedFile(writer, seed);
    const reduced = copy(seed);
    reduced.universities[0]!.aliases = [];
    reduced.universities[0]!.programs[0]!.domains = ["entrepreneurship"];

    await applySeedFile(writer, reduced);

    assert.equal(writer.universityAliases.size, 1);
    assert.equal(writer.programDomains.size, 2);
  });

  it("links summaries and windows to the source identity adopted by the writer", async () => {
    const seed = await readSeedFile(sampleUrl);
    const adoptedSourceId = stableSeedUuid("existing-source:programme-page");
    class AdoptingSeedWriter extends MemorySeedWriter {
      override async upsertSource(
        input: Parameters<SeedWriter["upsertSource"]>[0],
      ): Promise<string> {
        this.sources.set(adoptedSourceId, { ...input, id: adoptedSourceId });
        return adoptedSourceId;
      }
    }
    const writer = new AdoptingSeedWriter();

    await applySeedFile(writer, seed);

    const summary = [...writer.programSummaries.values()][0] as {
      lastVerifiedAt: string;
      sourceId: string;
      text: string;
    };
    const applicationWindow = [...writer.applicationWindows.values()][0] as {
      sourceId: string;
    };
    const source = seed.universities[0]!.programs[0]!.sources[0]!;
    assert.equal(summary.sourceId, adoptedSourceId);
    assert.equal(summary.lastVerifiedAt, source.lastCheckedAt);
    assert.equal(summary.text, seed.universities[0]!.programs[0]!.summary.text);
    assert.equal(applicationWindow.sourceId, adoptedSourceId);
  });
});
