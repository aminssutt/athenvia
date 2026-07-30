import type { Prisma, PrismaClient } from "@prisma/client";

import { database } from "./client";

type PushSubscriptionDatabase = Pick<Prisma.TransactionClient, "pushSubscription">;
type PushSubscriptionTransaction = Pick<
  Prisma.TransactionClient,
  "$executeRaw" | "pushSubscription"
>;
type TransactionalPushSubscriptionDatabase = Pick<PrismaClient, "$transaction">;

export const MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER = 10;

export type StorePushSubscriptionInput = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
};

export type RevokeInvalidPushSubscriptionsInput = {
  revokedAt: Date;
  subscriptionIds: string[];
  userId: string;
};

export class PushSubscriptionOwnershipConflictError extends Error {
  constructor() {
    super("The push endpoint is already owned by another account.");
    this.name = "PushSubscriptionOwnershipConflictError";
  }
}

export class PushSubscriptionLimitReachedError extends Error {
  constructor() {
    super("The account has reached its active push subscription limit.");
    this.name = "PushSubscriptionLimitReachedError";
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function rotateOwnedSubscription(
  input: StorePushSubscriptionInput,
  client: Pick<PushSubscriptionTransaction, "pushSubscription">,
): Promise<boolean> {
  const result = await client.pushSubscription.updateMany({
    where: {
      endpoint: input.endpoint,
      userId: input.userId,
    },
    data: {
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
      revokedAt: null,
    },
  });

  return result.count > 0;
}

async function activeSubscriptionLimitReached(
  userId: string,
  client: Pick<PushSubscriptionTransaction, "pushSubscription">,
): Promise<boolean> {
  const activeSubscriptionCount = await client.pushSubscription.count({
    where: {
      userId,
      revokedAt: null,
    },
  });

  return activeSubscriptionCount >= MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER;
}

/**
 * Stores or rotates a subscription without changing its owner.
 *
 * A per-user PostgreSQL advisory lock serializes the active-subscription limit.
 * Active rotations do not consume a new slot; reactivations do. A unique
 * endpoint race retries the complete transaction because PostgreSQL aborts the
 * transaction containing the failed create. Foreign-owned rows remain unchanged.
 */
export async function storePushSubscription(
  input: StorePushSubscriptionInput,
  client: TransactionalPushSubscriptionDatabase = database,
): Promise<void> {
  const persist = () =>
    client.$transaction(async (transaction) => {
      const lockName = `push-subscriptions:${input.userId}`;
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockName}, 0))
      `;

      const existingSubscription = await transaction.pushSubscription.findUnique({
        where: {
          endpoint: input.endpoint,
        },
        select: {
          userId: true,
          revokedAt: true,
        },
      });

      if (existingSubscription) {
        if (existingSubscription.userId !== input.userId) {
          return "ownership-conflict" as const;
        }
        if (
          existingSubscription.revokedAt &&
          (await activeSubscriptionLimitReached(input.userId, transaction))
        ) {
          return "limit-reached" as const;
        }

        await rotateOwnedSubscription(input, transaction);
        return "stored" as const;
      }

      await transaction.pushSubscription.deleteMany({
        where: {
          userId: input.userId,
          revokedAt: {
            not: null,
          },
        },
      });

      if (await activeSubscriptionLimitReached(input.userId, transaction)) {
        return "limit-reached" as const;
      }

      await transaction.pushSubscription.create({
        data: {
          userId: input.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          userAgent: input.userAgent,
        },
        select: {
          id: true,
        },
      });
      return "stored" as const;
    });

  let outcome: Awaited<ReturnType<typeof persist>>;
  try {
    outcome = await persist();
  } catch (error) {
    if (!isUniqueConstraintError(error)) {
      throw error;
    }

    try {
      outcome = await persist();
    } catch (retryError) {
      if (isUniqueConstraintError(retryError)) {
        throw new PushSubscriptionOwnershipConflictError();
      }
      throw retryError;
    }
  }

  if (outcome === "limit-reached") {
    throw new PushSubscriptionLimitReachedError();
  }
  if (outcome === "ownership-conflict") {
    throw new PushSubscriptionOwnershipConflictError();
  }
}

/**
 * Revokes only the authenticated user's matching endpoint.
 *
 * updateMany deliberately makes foreign-owned, unknown and already-revoked
 * endpoints indistinguishable. The service returns no row or key material.
 */
export async function revokePushSubscription(
  userId: string,
  endpoint: string,
  client: PushSubscriptionDatabase = database,
): Promise<void> {
  await client.pushSubscription.updateMany({
    where: {
      userId,
      endpoint,
      revokedAt: null,
    },
    data: {
      revokedAt: new Date(),
    },
  });
}

/**
 * Soft-revokes invalid delivery endpoints by their internal identifiers.
 *
 * The user ownership predicate prevents a stale or corrupted delivery result
 * from revoking another account's subscription. The active-only predicate
 * makes repeated Web Push failures idempotent. Endpoints and encryption keys
 * never cross this cleanup boundary.
 */
export async function revokeInvalidPushSubscriptions(
  input: RevokeInvalidPushSubscriptionsInput,
  client: PushSubscriptionDatabase = database,
): Promise<number> {
  if (!(input.revokedAt instanceof Date) || !Number.isFinite(input.revokedAt.getTime())) {
    throw new TypeError("Push subscription revocation requires a valid timestamp.");
  }
  const subscriptionIds = [...new Set(input.subscriptionIds)];
  if (subscriptionIds.length === 0) {
    return 0;
  }
  if (subscriptionIds.length > MAX_ACTIVE_PUSH_SUBSCRIPTIONS_PER_USER) {
    throw new RangeError("Too many push subscriptions were selected for revocation.");
  }

  const result = await client.pushSubscription.updateMany({
    data: {
      revokedAt: input.revokedAt,
    },
    where: {
      id: {
        in: subscriptionIds,
      },
      revokedAt: null,
      userId: input.userId,
    },
  });
  return result.count;
}
