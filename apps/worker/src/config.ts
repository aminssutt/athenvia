import { z } from "zod";

import { loadVapidConfiguration } from "./vapid-config";

const WorkerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  /** Root directory for immutable source snapshot objects. */
  SNAPSHOT_STORAGE_DIR: z.string().min(1).default("data/snapshots"),
  /** An official source is re-fetched once its last check is older than this. */
  SOURCE_RECHECK_DAYS: z.coerce.number().int().positive().default(7),
  /** Politeness cap: at most this many fetch jobs are enqueued per sweep. */
  SOURCE_RECHECK_BATCH: z.coerce.number().int().positive().default(25),
  /** Optional: enables the citation-constrained LLM extraction pass. */
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
});

export const workerEnvironment = WorkerEnvironmentSchema.parse(process.env);
export const vapidConfiguration = loadVapidConfiguration(process.env);
