import { readFile } from "node:fs/promises";

import { normalizeCatalogueName } from "./catalogue-normalization";
import { database } from "./client";

type SeedFile = {
  domains: Array<{ slug: string; name: string }>;
  universities: Array<{
    name: string;
    countryCode: string;
    city: string;
    officialDomain: string;
    officialWebsite: string;
    aliases: string[];
    programs: Array<{
      name: string;
      degreeType: "MASTER" | "MBA" | "PHD" | "OTHER";
      durationMonths: number | null;
      officialUrl: string;
      domains: string[];
      intake: { year: number; month: number };
      source: { url: string; sourceType: string; isOfficial: boolean };
    }>;
  }>;
};

const seedUrl = new URL("../../../data/seed/sample.json", import.meta.url);
const seed = JSON.parse(await readFile(seedUrl, "utf8")) as SeedFile;

for (const domain of seed.domains) {
  await database.domain.upsert({
    where: { slug: domain.slug },
    update: { name: domain.name },
    create: domain,
  });
}

for (const universitySeed of seed.universities) {
  const normalizedUniversityName = normalizeCatalogueName(universitySeed.name);
  const university = await database.university.upsert({
    where: {
      normalizedName_countryCode: {
        normalizedName: normalizedUniversityName,
        countryCode: universitySeed.countryCode,
      },
    },
    update: {
      city: universitySeed.city,
      officialDomain: universitySeed.officialDomain,
      officialWebsite: universitySeed.officialWebsite,
      status: "ACTIVE",
    },
    create: {
      name: universitySeed.name,
      normalizedName: normalizedUniversityName,
      countryCode: universitySeed.countryCode,
      city: universitySeed.city,
      officialDomain: universitySeed.officialDomain,
      officialWebsite: universitySeed.officialWebsite,
      status: "ACTIVE",
    },
  });

  for (const alias of universitySeed.aliases) {
    const normalizedAlias = normalizeCatalogueName(alias);
    await database.universityAlias.upsert({
      where: {
        universityId_normalizedAlias: {
          universityId: university.id,
          normalizedAlias,
        },
      },
      update: { alias },
      create: {
        universityId: university.id,
        alias,
        normalizedAlias,
      },
    });
  }

  for (const programSeed of universitySeed.programs) {
    const normalizedProgramName = normalizeCatalogueName(programSeed.name);
    const program = await database.program.upsert({
      where: {
        universityId_normalizedName_degreeType: {
          universityId: university.id,
          normalizedName: normalizedProgramName,
          degreeType: programSeed.degreeType,
        },
      },
      update: {
        durationMonths: programSeed.durationMonths,
        officialUrl: programSeed.officialUrl,
        status: "ACTIVE",
      },
      create: {
        universityId: university.id,
        name: programSeed.name,
        normalizedName: normalizedProgramName,
        degreeType: programSeed.degreeType,
        durationMonths: programSeed.durationMonths,
        officialUrl: programSeed.officialUrl,
        status: "ACTIVE",
      },
    });

    for (const domainSlug of programSeed.domains) {
      const domain = await database.domain.findUniqueOrThrow({ where: { slug: domainSlug } });
      await database.programDomain.upsert({
        where: { programId_domainId: { programId: program.id, domainId: domain.id } },
        update: {},
        create: { programId: program.id, domainId: domain.id },
      });
    }

    await database.intake.upsert({
      where: {
        programId_year_month: {
          programId: program.id,
          year: programSeed.intake.year,
          month: programSeed.intake.month,
        },
      },
      update: {},
      create: {
        programId: program.id,
        year: programSeed.intake.year,
        month: programSeed.intake.month,
        status: "PLANNED",
      },
    });

    const existingSource = await database.source.findFirst({
      where: { programId: program.id, url: programSeed.source.url },
    });
    if (!existingSource) {
      await database.source.create({
        data: {
          universityId: university.id,
          programId: program.id,
          ...programSeed.source,
        },
      });
    }
  }
}

await database.$disconnect();
