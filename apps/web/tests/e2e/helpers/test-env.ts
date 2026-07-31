import { existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/**
 * Shared environment bootstrap for the Playwright config and the e2e specs.
 *
 * Mirrors scripts/with-env.mjs: loads the repo-root .env when present and
 * derives DATABASE_URL / REDIS_URL from the POSTGRES_* / REDIS_* parts so the
 * dev web server under test and the tests themselves see the same database.
 *
 * Database-backed journeys (search, follow, contribution review) skip
 * gracefully when no database is reachable, so the suite stays green in
 * environments without Postgres (for example the current CI e2e job).
 */

const repositoryRoot = path.resolve(__dirname, "..", "..", "..", "..", "..");
const environmentFile = path.join(repositoryRoot, ".env");

if (existsSync(environmentFile)) {
  try {
    process.loadEnvFile(environmentFile);
  } catch {
    // A malformed .env must not break the suite; ambient env still applies.
  }
}

const requiredDatabaseParts = ["POSTGRES_DB", "POSTGRES_PASSWORD", "POSTGRES_USER"] as const;
if (
  !process.env.DATABASE_URL &&
  requiredDatabaseParts.every((name) => Boolean(process.env[name]))
) {
  const databaseName = encodeURIComponent(process.env.POSTGRES_DB as string);
  const password = encodeURIComponent(process.env.POSTGRES_PASSWORD as string);
  const port = encodeURIComponent(process.env.POSTGRES_PORT ?? "5432");
  const user = encodeURIComponent(process.env.POSTGRES_USER as string);
  // 127.0.0.1 (not localhost) avoids IPv6-first resolution stalls on Windows.
  process.env.DATABASE_URL = `postgresql://${user}:${password}@127.0.0.1:${port}/${databaseName}`;
}

if (!process.env.REDIS_URL && process.env.REDIS_PASSWORD) {
  const password = encodeURIComponent(process.env.REDIS_PASSWORD);
  const port = encodeURIComponent(process.env.REDIS_PORT ?? "6379");
  process.env.REDIS_URL = `redis://:${password}@127.0.0.1:${port}`;
}

/** True when the catalogue database is configured for this run. */
export const databaseAvailable = Boolean(process.env.DATABASE_URL);

/** Base URL shared with playwright.config.ts. */
export const E2E_BASE_URL = "http://127.0.0.1:3100";

/** Admin allowlisted for the review-queue journeys (see webServer env). */
export const E2E_ADMIN_EMAIL = "e2e-admin@athenvia.example";

/**
 * Deterministic VAPID pair for e2e only (never used in production). The
 * public key is a valid 65-byte uncompressed P-256 point, as required by
 * /api/push/vapid-public-key and decodePublicVapidKey.
 */
export const E2E_VAPID_PUBLIC_KEY =
  process.env.VAPID_PUBLIC_KEY ??
  "BKX-uKxzLD5OBw41W4YbTENDPgDnLF3Ecx440eFgEbZCNrpMO1VjbU_JVJt3yarYL2odK_uN40ZXEwpWYpLWLUc";
export const E2E_VAPID_PRIVATE_KEY =
  process.env.VAPID_PRIVATE_KEY ?? "sqPCUWfTDeid5mLkeYwodJqCsd984CiipY86QJy96qo";

/** Environment forwarded to the Next.js dev server under test. */
export function webServerEnvironment(): Record<string, string> {
  const environment: Record<string, string | undefined> = {
    ATHENVIA_ADMIN_EMAILS: process.env.ATHENVIA_ADMIN_EMAILS
      ? `${process.env.ATHENVIA_ADMIN_EMAILS},${E2E_ADMIN_EMAIL}`
      : E2E_ADMIN_EMAIL,
    AUTH_SECRET: process.env.AUTH_SECRET ?? "athenvia-e2e-only-secret-not-for-production",
    DATABASE_URL: process.env.DATABASE_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "athenvia-e2e.apps.googleusercontent.com",
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "athenvia-e2e-google-secret",
    NEXTAUTH_URL: E2E_BASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    VAPID_PUBLIC_KEY: E2E_VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY: E2E_VAPID_PRIVATE_KEY,
    VAPID_SUBJECT: process.env.VAPID_SUBJECT ?? "mailto:e2e@athenvia.example",
  };

  return Object.fromEntries(
    Object.entries(environment).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}
