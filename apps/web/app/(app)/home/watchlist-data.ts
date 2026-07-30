import { WatchlistResponseSchema } from "@athenvia/contracts";
import { database } from "@athenvia/database";

import type {
  ProgramSummary,
  TrackingStatus,
  WatchlistItem,
  WatchlistResponse,
} from "@athenvia/contracts";
import type { Prisma } from "@athenvia/database";

import {
  formatIntakeLabel,
  nextUsefulDate,
  toPublicApplicationWindow,
} from "../../../lib/catalogue-presentation";

const ownedWatchlistSelect = {
  id: true,
  intakeId: true,
  program: {
    select: {
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
      name: true,
      university: {
        select: {
          city: true,
          countryCode: true,
          id: true,
          name: true,
        },
      },
    },
  },
  programId: true,
  trackingStatus: true,
  userId: true,
  intake: {
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
      programId: true,
      year: true,
    },
  },
} satisfies Prisma.UserWatchlistSelect;

type OwnedWatchlistRecord = Prisma.UserWatchlistGetPayload<{
  select: typeof ownedWatchlistSelect;
}>;

export type WatchlistClient = Pick<typeof database, "userWatchlist">;

function presentWatchlistProgram(record: OwnedWatchlistRecord): ProgramSummary | null {
  if (
    record.programId !== record.program.id ||
    record.intakeId !== record.intake.id ||
    record.intake.programId !== record.programId
  ) {
    return null;
  }

  return {
    degreeType: record.program.degreeType,
    domains: record.program.domains.map(({ domain }) => domain.name),
    durationMonths: record.program.durationMonths,
    id: record.program.id,
    intakeLabel: formatIntakeLabel(record.intake.year, record.intake.month),
    location: record.program.campus ?? record.program.university.city,
    name: record.program.name,
    nextWindow: toPublicApplicationWindow(record.intake.applicationWindows[0], record.program.id),
    university: {
      city: record.program.university.city,
      countryCode: record.program.university.countryCode,
      id: record.program.university.id,
      logoUrl: null,
      name: record.program.university.name,
    },
  };
}

function emptyWatchlist(): Record<TrackingStatus, WatchlistItem[]> {
  return {
    APPLIED: [],
    OPEN_NOW: [],
    WATCHING: [],
  };
}

export async function loadWatchlist(
  userId: string,
  client: WatchlistClient = database,
  now: Date = new Date(),
): Promise<WatchlistResponse> {
  const records = await client.userWatchlist.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
    select: ownedWatchlistSelect,
    where: {
      program: {
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
      userId,
    },
  });

  const grouped = emptyWatchlist();
  for (const record of records) {
    if (record.userId !== userId) {
      continue;
    }
    const program = presentWatchlistProgram(record);
    if (!program) {
      continue;
    }
    grouped[record.trackingStatus].push({
      id: record.id,
      nextUsefulDate: nextUsefulDate(record.intake.applicationWindows, now),
      program,
      trackingStatus: record.trackingStatus,
    });
  }

  return WatchlistResponseSchema.parse({
    applied: grouped.APPLIED,
    openNow: grouped.OPEN_NOW,
    watching: grouped.WATCHING,
  });
}
