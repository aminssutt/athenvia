import { createHash } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { normalizeCatalogueName } from "./catalogue-normalization";

import type {
  SeedApplicationWindow,
  SeedFile,
  SeedIntake,
  SeedProgram,
  SeedSource,
  SeedUniversity,
} from "./seed-format";

const SEED_UUID_NAMESPACE = "b45cb534-ec7d-5aa2-8a4f-d1f599ed56d2";
const SEED_LOCK_KEY = "athenvia:source-backed-seed:v1";

type UniversityWrite = Omit<SeedUniversity, "aliases" | "programs"> & { id: string };
type ProgramWrite = Omit<SeedProgram, "domains" | "intakes" | "sources" | "summary"> & {
  id: string;
  universityId: string;
};
type SourceWrite = SeedSource & {
  id: string;
  programId: string;
  universityId: string;
};
type IntakeWrite = Omit<SeedIntake, "applicationWindows"> & {
  id: string;
  programId: string;
};
type ApplicationWindowWrite = SeedApplicationWindow & {
  id: string;
  intakeId: string;
};

export type SeedImportCounts = {
  applicationWindows: number;
  domains: number;
  intakes: number;
  programs: number;
  sources: number;
  universities: number;
};

export interface SeedWriter {
  upsertDomain(input: { id: string; slug: string; name: string }): Promise<string>;
  upsertUniversity(input: UniversityWrite): Promise<string>;
  upsertUniversityAlias(input: { alias: string; id: string; universityId: string }): Promise<void>;
  upsertProgram(input: ProgramWrite): Promise<string>;
  connectProgramDomain(input: { domainId: string; programId: string }): Promise<void>;
  upsertSource(input: SourceWrite): Promise<string>;
  upsertIntake(input: IntakeWrite): Promise<string>;
  upsertApplicationWindow(input: ApplicationWindowWrite): Promise<void>;
}

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replaceAll("-", ""), "hex");
}

export function stableSeedUuid(identity: string): string {
  const digest = createHash("sha1")
    .update(uuidBytes(SEED_UUID_NAMESPACE))
    .update(identity, "utf8")
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hexadecimal = digest.toString("hex");
  return [
    hexadecimal.slice(0, 8),
    hexadecimal.slice(8, 12),
    hexadecimal.slice(12, 16),
    hexadecimal.slice(16, 20),
    hexadecimal.slice(20),
  ].join("-");
}

function increment(counts: SeedImportCounts, key: keyof SeedImportCounts): void {
  counts[key] += 1;
}

export async function applySeedFile(
  writer: SeedWriter,
  seed: SeedFile,
  counts: SeedImportCounts = emptySeedImportCounts(),
): Promise<SeedImportCounts> {
  const domainIds = new Map<string, string>();
  for (const domain of seed.domains) {
    const id = await writer.upsertDomain({
      id: stableSeedUuid(`domain:${domain.slug}`),
      ...domain,
    });
    domainIds.set(domain.slug, id);
    increment(counts, "domains");
  }

  for (const universitySeed of seed.universities) {
    const universityIdentity = `university:${universitySeed.key}`;
    const universityId = await writer.upsertUniversity({
      id: stableSeedUuid(universityIdentity),
      key: universitySeed.key,
      name: universitySeed.name,
      countryCode: universitySeed.countryCode,
      city: universitySeed.city,
      officialDomain: universitySeed.officialDomain,
      officialWebsite: universitySeed.officialWebsite,
    });
    increment(counts, "universities");

    for (const alias of universitySeed.aliases) {
      await writer.upsertUniversityAlias({
        alias,
        id: stableSeedUuid(`${universityIdentity}:alias:${normalizeCatalogueName(alias)}`),
        universityId,
      });
    }

    for (const programSeed of universitySeed.programs) {
      const programIdentity = `${universityIdentity}:program:${programSeed.key}`;
      const programId = await writer.upsertProgram({
        id: stableSeedUuid(programIdentity),
        universityId,
        key: programSeed.key,
        name: programSeed.name,
        degreeType: programSeed.degreeType,
        durationMonths: programSeed.durationMonths,
        campus: programSeed.campus,
        language: programSeed.language,
        officialUrl: programSeed.officialUrl,
      });
      increment(counts, "programs");

      for (const domainSlug of programSeed.domains) {
        await writer.connectProgramDomain({
          domainId: domainIds.get(domainSlug)!,
          programId,
        });
      }

      for (const sourceSeed of programSeed.sources) {
        await writer.upsertSource({
          ...sourceSeed,
          id: stableSeedUuid(`${programIdentity}:source:${sourceSeed.key}`),
          programId,
          universityId,
        });
        increment(counts, "sources");
      }

      // Summary text and its sourceKey are deliberately validated and retained
      // in the seed file, but persistence is deferred to #148. Silently putting
      // canonical product copy in DataRevision would misuse the audit log.
      void programSeed.summary;

      for (const intakeSeed of programSeed.intakes) {
        const intakeIdentity = `${programIdentity}:intake:${intakeSeed.key}`;
        const intakeId = await writer.upsertIntake({
          id: stableSeedUuid(intakeIdentity),
          programId,
          key: intakeSeed.key,
          year: intakeSeed.year,
          month: intakeSeed.month,
          status: intakeSeed.status,
        });
        increment(counts, "intakes");

        for (const windowSeed of intakeSeed.applicationWindows) {
          await writer.upsertApplicationWindow({
            ...windowSeed,
            id: stableSeedUuid(`${intakeIdentity}:window:${windowSeed.key}`),
            intakeId,
          });
          increment(counts, "applicationWindows");
        }
      }
    }
  }

  return counts;
}

export function emptySeedImportCounts(): SeedImportCounts {
  return {
    applicationWindows: 0,
    domains: 0,
    intakes: 0,
    programs: 0,
    sources: 0,
    universities: 0,
  };
}

export function countSeedFiles(seeds: readonly SeedFile[]): SeedImportCounts {
  const counts = emptySeedImportCounts();
  for (const seed of seeds) {
    counts.domains += seed.domains.length;
    counts.universities += seed.universities.length;
    for (const university of seed.universities) {
      counts.programs += university.programs.length;
      for (const program of university.programs) {
        counts.sources += program.sources.length;
        counts.intakes += program.intakes.length;
        for (const intake of program.intakes) {
          counts.applicationWindows += intake.applicationWindows.length;
        }
      }
    }
  }
  return counts;
}

class PrismaSeedWriter implements SeedWriter {
  constructor(private readonly transaction: Prisma.TransactionClient) {}

  async upsertDomain(input: { id: string; slug: string; name: string }): Promise<string> {
    const existing =
      (await this.transaction.domain.findUnique({
        where: { id: input.id },
        select: { id: true },
      })) ??
      (await this.transaction.domain.findUnique({
        where: { slug: input.slug },
        select: { id: true },
      }));
    if (existing) {
      const updated = await this.transaction.domain.update({
        where: { id: existing.id },
        data: { name: input.name },
        select: { id: true },
      });
      return updated.id;
    }
    const created = await this.transaction.domain.create({
      data: input,
      select: { id: true },
    });
    return created.id;
  }

  async upsertUniversity(input: UniversityWrite): Promise<string> {
    const naturalIdentity = {
      normalizedName: normalizeCatalogueName(input.name),
      countryCode: input.countryCode,
    };
    const existing =
      (await this.transaction.university.findUnique({
        where: { id: input.id },
        select: { id: true },
      })) ??
      (await this.transaction.university.findUnique({
        where: { normalizedName_countryCode: naturalIdentity },
        select: { id: true },
      }));
    const data = {
      name: input.name,
      normalizedName: naturalIdentity.normalizedName,
      countryCode: input.countryCode,
      city: input.city,
      officialDomain: input.officialDomain,
      officialWebsite: input.officialWebsite,
      status: "ACTIVE" as const,
    };
    if (existing) {
      const updated = await this.transaction.university.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
      return updated.id;
    }
    const created = await this.transaction.university.create({
      data: { id: input.id, ...data },
      select: { id: true },
    });
    return created.id;
  }

  async upsertUniversityAlias(input: {
    alias: string;
    id: string;
    universityId: string;
  }): Promise<void> {
    const normalizedAlias = normalizeCatalogueName(input.alias);
    await this.transaction.universityAlias.upsert({
      where: {
        universityId_normalizedAlias: {
          universityId: input.universityId,
          normalizedAlias,
        },
      },
      update: { alias: input.alias },
      create: { ...input, normalizedAlias },
    });
  }

  async upsertProgram(input: ProgramWrite): Promise<string> {
    const naturalIdentity = {
      universityId: input.universityId,
      normalizedName: normalizeCatalogueName(input.name),
      degreeType: input.degreeType,
    };
    const existing =
      (await this.transaction.program.findUnique({
        where: { id: input.id },
        select: { id: true },
      })) ??
      (await this.transaction.program.findUnique({
        where: { universityId_normalizedName_degreeType: naturalIdentity },
        select: { id: true },
      }));
    const data = {
      universityId: input.universityId,
      name: input.name,
      normalizedName: naturalIdentity.normalizedName,
      degreeType: input.degreeType,
      durationMonths: input.durationMonths,
      campus: input.campus,
      language: input.language,
      officialUrl: input.officialUrl,
      status: "ACTIVE" as const,
    };
    if (existing) {
      const updated = await this.transaction.program.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
      return updated.id;
    }
    const created = await this.transaction.program.create({
      data: { id: input.id, ...data },
      select: { id: true },
    });
    return created.id;
  }

  async connectProgramDomain(input: { domainId: string; programId: string }): Promise<void> {
    await this.transaction.programDomain.upsert({
      where: { programId_domainId: input },
      update: {},
      create: input,
    });
  }

  async upsertSource(input: SourceWrite): Promise<string> {
    const existing =
      (await this.transaction.source.findUnique({
        where: { id: input.id },
        select: { id: true, lastCheckedAt: true },
      })) ??
      (await this.transaction.source.findFirst({
        where: { programId: input.programId, url: input.url },
        select: { id: true, lastCheckedAt: true },
      }));
    const proposedCheck = new Date(input.lastCheckedAt);
    const data = {
      universityId: input.universityId,
      programId: input.programId,
      url: input.url,
      sourceType: input.sourceType,
      isOfficial: input.isOfficial,
      lastCheckedAt:
        existing?.lastCheckedAt && existing.lastCheckedAt > proposedCheck
          ? existing.lastCheckedAt
          : proposedCheck,
    };
    if (existing) {
      const updated = await this.transaction.source.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
      return updated.id;
    }
    const created = await this.transaction.source.create({
      data: { id: input.id, ...data },
      select: { id: true },
    });
    return created.id;
  }

  async upsertIntake(input: IntakeWrite): Promise<string> {
    const naturalIdentity = {
      programId: input.programId,
      year: input.year,
      month: input.month,
    };
    const existing =
      (await this.transaction.intake.findUnique({
        where: { id: input.id },
        select: { id: true },
      })) ??
      (await this.transaction.intake.findUnique({
        where: { programId_year_month: naturalIdentity },
        select: { id: true },
      }));
    const data = {
      programId: input.programId,
      year: input.year,
      month: input.month,
      status: input.status,
    };
    if (existing) {
      const updated = await this.transaction.intake.update({
        where: { id: existing.id },
        data,
        select: { id: true },
      });
      return updated.id;
    }
    const created = await this.transaction.intake.create({
      data: { id: input.id, ...data },
      select: { id: true },
    });
    return created.id;
  }

  async upsertApplicationWindow(input: ApplicationWindowWrite): Promise<void> {
    const existing = await this.transaction.applicationWindow.findUnique({
      where: { id: input.id },
      select: { lastVerifiedAt: true },
    });
    const proposedVerification = new Date(input.lastVerifiedAt);
    if (
      existing?.lastVerifiedAt &&
      existing.lastVerifiedAt.getTime() > proposedVerification.getTime()
    ) {
      return;
    }
    const data = {
      roundName: input.roundName,
      opensAt: input.opensAt ? new Date(input.opensAt) : null,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
      publicStatus: input.publicStatus,
      verification: input.verification,
      lastVerifiedAt: proposedVerification,
    };
    if (existing) {
      await this.transaction.applicationWindow.update({
        where: { id: input.id },
        data,
      });
      return;
    }
    await this.transaction.applicationWindow.create({
      data: {
        id: input.id,
        intakeId: input.intakeId,
        roundName: input.roundName,
        opensAt: input.opensAt ? new Date(input.opensAt) : null,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        publicStatus: input.publicStatus,
        verification: input.verification,
        lastVerifiedAt: proposedVerification,
      },
    });
  }
}

export async function importSeedFiles(
  database: PrismaClient,
  seeds: readonly SeedFile[],
): Promise<SeedImportCounts> {
  return database.$transaction(
    async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${SEED_LOCK_KEY}, 0))`;
      const writer = new PrismaSeedWriter(transaction);
      const counts = emptySeedImportCounts();
      for (const seed of seeds) {
        await applySeedFile(writer, seed, counts);
      }
      return counts;
    },
    { timeout: 60_000 },
  );
}
