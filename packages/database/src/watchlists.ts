import { EntityStatus } from "@prisma/client";

import type { Prisma } from "@prisma/client";

import { database } from "./client";

const publicWatchlistSelection = {
  id: true,
  programId: true,
  intakeId: true,
  trackingStatus: true,
  priority: true,
  createdAt: true,
  notificationPreference: {
    select: {
      beforeOpenDays: true,
      beforeDeadlineDays: true,
      notifyOnOpen: true,
      notifyOnDateChange: true,
      pushEnabled: true,
    },
  },
} satisfies Prisma.UserWatchlistSelect;

export type PublicWatchlist = Prisma.UserWatchlistGetPayload<{
  select: typeof publicWatchlistSelection;
}>;

export type FollowProgramInput = {
  userId: string;
  programId: string;
  intakeId: string;
};

export type FollowProgramResult = {
  created: boolean;
  watchlist: PublicWatchlist;
};

export class WatchlistTargetNotFoundError extends Error {
  constructor() {
    super("The requested active program intake does not exist.");
    this.name = "WatchlistTargetNotFoundError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

/**
 * Creates a private watchlist and its default notification preferences atomically.
 *
 * The database uniqueness constraint is the final concurrency guard. A racing
 * duplicate request resolves to the already-owned row instead of creating a
 * second watchlist.
 */
export async function followProgram(input: FollowProgramInput): Promise<FollowProgramResult> {
  try {
    const watchlist = await database.$transaction(async (transaction) => {
      const target = await transaction.intake.findFirst({
        where: {
          id: input.intakeId,
          programId: input.programId,
          program: {
            status: EntityStatus.ACTIVE,
            university: {
              status: EntityStatus.ACTIVE,
            },
          },
        },
        select: { id: true },
      });

      if (!target) {
        throw new WatchlistTargetNotFoundError();
      }

      return transaction.userWatchlist.create({
        data: {
          userId: input.userId,
          programId: input.programId,
          intakeId: input.intakeId,
          notificationPreference: {
            create: {},
          },
        },
        select: publicWatchlistSelection,
      });
    });

    return { created: true, watchlist };
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    const existingWatchlist = await database.userWatchlist.findUnique({
      where: {
        userId_programId_intakeId: {
          userId: input.userId,
          programId: input.programId,
          intakeId: input.intakeId,
        },
      },
      select: publicWatchlistSelection,
    });

    if (!existingWatchlist) {
      throw error;
    }

    return { created: false, watchlist: existingWatchlist };
  }
}

/**
 * Removes only a row owned by the authenticated user.
 *
 * deleteMany intentionally makes an unknown, already-deleted, or foreign-owned
 * identifier indistinguishable and idempotent for the caller.
 */
export async function unfollowProgram(userId: string, watchlistId: string): Promise<boolean> {
  const result = await database.userWatchlist.deleteMany({
    where: {
      id: watchlistId,
      userId,
    },
  });

  return result.count > 0;
}
