import { z } from "zod";

const WorkerEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
});

export const workerEnvironment = WorkerEnvironmentSchema.parse(process.env);
