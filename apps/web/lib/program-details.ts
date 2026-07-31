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

type DetailIntake = PublicProgramDetailRecord["intakes"][number];
type DetailWindow = DetailIntake["applicationWindows"][number];

/**
 * A window is still worth showing when its deadline has not passed, or when no
 * deadline is published yet. The database orders windows by `closesAt`, which
 * on its own would surface an expired deadline as the next one.
 */
function isActionableWindow(window: DetailWindow, now: Date): boolean {
  return window.closesAt === null || window.closesAt.getTime() > now.getTime();
}

function selectPrimaryIntake(intakes: DetailIntake[], now: Date): DetailIntake | undefined {
  return (
    intakes.find((intake) =>
      intake.applicationWindows.some((window) => isActionableWindow(window, now)),
    ) ??
    intakes.at(-1) ??
    intakes[0]
  );
}

function selectNextWindow(intake: DetailIntake, now: Date): DetailWindow | undefined {
  return (
    intake.applicationWindows.find((window) => isActionableWindow(window, now)) ??
    intake.applicationWindows[0]
  );
}

export function presentProgramDetail(
  record: PublicProgramDetailRecord,
  now: Date = new Date(),
): ProgramDetail | null {
  const primaryIntake = selectPrimaryIntake(record.intakes, now);
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
    nextWindow: toPublicApplicationWindow(selectNextWindow(primaryIntake, now), record.id),
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
