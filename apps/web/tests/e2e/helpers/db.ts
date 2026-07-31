import { randomUUID } from "node:crypto";

import "./test-env";

import type { BrowserContext } from "@playwright/test";

/**
 * Direct database access for the e2e journeys.
 *
 * NextAuth uses the database session strategy, so a signed-in state is a User
 * row plus a Session row referenced by the next-auth.session-token cookie.
 * This mirrors what a real magic-link sign-in produces, without SMTP.
 *
 * The import stays lazy so specs can skip cleanly when no database is
 * configured (see helpers/test-env.ts).
 */
async function databaseClient() {
  // Each Playwright worker gets its own Prisma client. Left at the default
  // pool size, six workers plus the dev server can exhaust Postgres
  // max_connections; a tiny pool is plenty for test fixtures.
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl && !databaseUrl.includes("connection_limit=")) {
    const separator = databaseUrl.includes("?") ? "&" : "?";
    process.env.DATABASE_URL = `${databaseUrl}${separator}connection_limit=2&pool_timeout=30&connect_timeout=30`;
  }
  const { database } = await import("@athenvia/database");
  return database;
}

export const SESSION_COOKIE_NAME = "next-auth.session-token";

export type AuthenticatedActor = {
  email: string;
  sessionToken: string;
  userId: string;
};

export async function createAuthenticatedActor(email: string): Promise<AuthenticatedActor> {
  const database = await databaseClient();
  const user = await database.user.upsert({
    where: { email },
    create: { email, emailVerified: new Date() },
    update: {},
    select: { id: true },
  });
  const sessionToken = randomUUID();
  await database.session.create({
    data: {
      expires: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      sessionToken,
      userId: user.id,
    },
  });
  return { email, sessionToken, userId: user.id };
}

export async function signInContext(
  context: BrowserContext,
  actor: AuthenticatedActor,
  baseUrl: string,
): Promise<void> {
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: actor.sessionToken,
      url: baseUrl,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function deleteActor(actor: AuthenticatedActor): Promise<void> {
  const database = await databaseClient();
  await database.user.deleteMany({ where: { id: actor.userId } });
}

/**
 * Ends an actor's sessions without deleting the account. Reviewer accounts
 * must survive: data_revisions.created_by_user_id is ON DELETE RESTRICT (see
 * migration 20260730180000_revision_conflict_guards), so a user who decided
 * a review can never be removed.
 */
export async function deleteActorSessions(actor: AuthenticatedActor): Promise<void> {
  const database = await databaseClient();
  await database.session.deleteMany({ where: { userId: actor.userId } });
}

/** Sweeps signed-in fixtures an interrupted earlier run may have left. */
export async function deleteActorsByEmailPrefix(emailPrefix: string): Promise<void> {
  const database = await databaseClient();
  await database.user.deleteMany({ where: { email: { startsWith: emailPrefix } } });
}

/**
 * Clears the persisted submission rate-limit counters (5/user/h, 20/client/h,
 * keyed on hashed IP in Redis) so repeated local runs do not exhaust the
 * shared client budget. No-op when Redis is not configured.
 */
export async function resetUniversitySubmissionRateLimit(): Promise<void> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return;
  }
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(redisUrl, {
    connectTimeout: 3_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  try {
    await redis.connect();
    const keys = await redis.keys("athenvia:university-submission:*");
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } catch {
    // Best effort: without Redis the API falls back to in-memory counters.
  } finally {
    redis.disconnect();
  }
}

/** A followable program: active intake attached, name suitable for search. */
export type FollowableProgram = {
  id: string;
  name: string;
  universityName: string;
};

export async function findFollowableProgram(
  nameContains: string,
): Promise<FollowableProgram | null> {
  const database = await databaseClient();
  const programs = await database.program.findMany({
    where: {
      name: { contains: nameContains, mode: "insensitive" },
      status: "ACTIVE",
      intakes: { some: {} },
      // Search results only list programs with an official summary source,
      // so the picked program must satisfy the same constraint.
      summary: { is: { source: { isOfficial: true } } },
      university: { status: "ACTIVE" },
    },
    orderBy: { name: "asc" },
    take: 50,
    select: { id: true, name: true, university: { select: { name: true } } },
  });
  // Prefer a program whose name is unique in the results so the search page
  // shows exactly one matching card.
  const nameCounts = new Map<string, number>();
  for (const program of programs) {
    nameCounts.set(program.name, (nameCounts.get(program.name) ?? 0) + 1);
  }
  const program = programs.find((candidate) => nameCounts.get(candidate.name) === 1) ?? programs[0];
  return program
    ? { id: program.id, name: program.name, universityName: program.university.name }
    : null;
}

export async function countWatchlistRows(userId: string): Promise<number> {
  const database = await databaseClient();
  return database.userWatchlist.count({ where: { userId } });
}

export async function findPushSubscriptionEndpoints(userId: string): Promise<string[]> {
  const database = await databaseClient();
  const rows = await database.pushSubscription.findMany({
    where: { userId, revokedAt: null },
    select: { endpoint: true },
  });
  return rows.map((row) => row.endpoint);
}

export type SubmissionSnapshot = {
  id: string;
  status: string;
};

export async function findUniversitySubmission(name: string): Promise<SubmissionSnapshot | null> {
  const database = await databaseClient();
  const submission = await database.universitySubmission.findFirst({
    where: { name },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true },
  });
  return submission ?? null;
}

export async function findPublishedUniversity(
  name: string,
): Promise<{ id: string; status: string } | null> {
  const database = await databaseClient();
  const university = await database.university.findFirst({
    where: { name },
    select: { id: true, status: true },
  });
  return university ?? null;
}

/**
 * Removes the traces a contribution run leaves behind. data_revisions is
 * protected by an append-only database trigger, so pending review rows are
 * closed as REJECTED (allowed, mirrors an admin decision) instead of deleted.
 * Cleans by prefix so an interrupted earlier run self-heals too.
 */
export async function cleanupContributedUniversities(namePrefix: string): Promise<void> {
  const database = await databaseClient();
  const submissions = await database.universitySubmission.findMany({
    where: { name: { startsWith: namePrefix } },
    select: { id: true },
  });
  const submissionIds = submissions.map((submission) => submission.id);
  if (submissionIds.length > 0) {
    await database.dataRevision.updateMany({
      where: {
        changeStatus: "PENDING",
        entityId: { in: submissionIds },
        entityType: "UNIVERSITY_SUBMISSION",
      },
      data: { changeStatus: "REJECTED", reviewedAt: new Date() },
    });
  }
  const universities = await database.university.findMany({
    where: { name: { startsWith: namePrefix } },
    select: { id: true },
  });
  for (const university of universities) {
    await database.source.deleteMany({ where: { universityId: university.id } });
  }
  await database.university.deleteMany({ where: { name: { startsWith: namePrefix } } });
  await database.universitySubmission.deleteMany({ where: { name: { startsWith: namePrefix } } });
}
