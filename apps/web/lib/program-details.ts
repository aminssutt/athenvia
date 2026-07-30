import { ProgramDetailSchema } from "@athenvia/contracts";
import { database } from "@athenvia/database";

import type { ProgramDetail } from "@athenvia/contracts";
import type { Prisma } from "@athenvia/database";

import {
  formatIntakeLabel,
  safeOfficialUrl,
  toPublicApplicationWindow,
} from "./catalogue-presentation";

const publicProgramDetailSelect = {
  campus: true,
  degreeType: true,
  domains: {
    orderBy: { domain: { name: "asc" } },
    select: {
      domain: {
        select: { name: true },
      },
    },
  },
  durationMonths: true,
  id: true,
  intakes: {
    orderBy: [{ year: "asc" }, { month: "asc" }],
    select: {
      applicationWindows: {
        orderBy: [{ closesAt: "asc" }, { opensAt: "asc" }, { id: "asc" }],
        select: {
          closesAt: true,
          id: true,
          opensAt: true,
          publicStatus: true,
          roundName: true,
          source: {
            select: {
              isOfficial: true,
              programId: true,
              url: true,
            },
          },
        },
      },
      id: true,
      month: true,
      year: true,
    },
  },
  name: true,
  summary: {
    select: {
      source: {
        select: {
          isOfficial: true,
          programId: true,
          url: true,
        },
      },
      text: true,
    },
  },
  university: {
    select: {
      city: true,
      countryCode: true,
      id: true,
      name: true,
    },
  },
} satisfies Prisma.ProgramSelect;

type PublicProgramDetailRecord = Prisma.ProgramGetPayload<{
  select: typeof publicProgramDetailSelect;
}>;

export type ProgramDetailClient = Pick<typeof database, "program">;

export function presentProgramDetail(record: PublicProgramDetailRecord): ProgramDetail | null {
  const primaryIntake = record.intakes[0];
  const summarySourceUrl =
    record.summary?.source.isOfficial && record.summary.source.programId === record.id
      ? safeOfficialUrl(record.summary.source.url)
      : null;

  if (!primaryIntake || !record.summary || !summarySourceUrl) {
    return null;
  }

  return ProgramDetailSchema.parse({
    degreeType: record.degreeType,
    domains: record.domains.map(({ domain }) => domain.name),
    durationMonths: record.durationMonths,
    id: record.id,
    intakeLabel: formatIntakeLabel(primaryIntake.year, primaryIntake.month),
    intakes: record.intakes.map((intake) => ({
      id: intake.id,
      label: formatIntakeLabel(intake.year, intake.month),
    })),
    location: record.campus ?? record.university.city,
    name: record.name,
    nextWindow: toPublicApplicationWindow(primaryIntake.applicationWindows[0], record.id),
    summary: {
      officialSourceUrl: summarySourceUrl,
      text: record.summary.text,
    },
    university: {
      city: record.university.city,
      countryCode: record.university.countryCode,
      id: record.university.id,
      logoUrl: null,
      name: record.university.name,
    },
  });
}

export async function findPublicProgramDetail(
  programId: string,
  client: ProgramDetailClient = database,
): Promise<ProgramDetail | null> {
  const record = await client.program.findFirst({
    where: {
      id: programId,
      intakes: { some: {} },
      status: "ACTIVE",
      summary: {
        is: {
          source: {
            is: {
              isOfficial: true,
            },
          },
        },
      },
      university: {
        is: {
          status: "ACTIVE",
        },
      },
    },
    select: publicProgramDetailSelect,
  });

  return record ? presentProgramDetail(record) : null;
}
