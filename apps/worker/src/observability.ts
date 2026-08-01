import { randomUUID } from "node:crypto";

import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

const ERROR_LEVEL = 50;
const LOG_LEVELS = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);
const REDACTED_PATHS = [
  "authorization",
  "body",
  "cookie",
  "databaseUrl",
  "email",
  "endpoint",
  "headers",
  "password",
  "payload",
  "privateKey",
  "redisUrl",
  "secret",
  "token",
  "url",
  "job.data",
  "*.authorization",
  "*.cookie",
  "*.databaseUrl",
  "*.email",
  "*.endpoint",
  "*.password",
  "*.privateKey",
  "*.redisUrl",
  "*.secret",
  "*.token",
  "*.url",
];

function safeError(value: unknown): { name: string } {
  const name = value instanceof Error ? value.name : value;
  return {
    name:
      typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)
        ? name
        : "UnknownError",
  };
}

const STRING_FIELDS = new Set([
  "changeStatus",
  "correlationId",
  "deadLetterJobId",
  "deliveryId",
  "entityType",
  "event",
  "eventId",
  "fieldName",
  "finalStatus",
  "intakeId",
  "jobId",
  "jobName",
  "queue",
  "revisionId",
  "signal",
  "sourceId",
  "sourceJobId",
  "sourceQueue",
  "sourceSnapshotId",
  "sourceStage",
]);
const NUMBER_FIELDS = new Set([
  "attempt",
  "attemptsMade",
  "candidates",
  "created",
  "enqueued",
  "httpStatus",
  "llmClaims",
  "llmVerified",
  "rejectedQuotes",
  "indeterminateFailureCount",
  "matched",
  "permanentFailureCount",
  "planned",
  "quarantinedCount",
  "queuedCount",
  "recoveredCount",
  "rescheduled",
  "revisionsCreated",
  "revokedCount",
  "scannedCount",
  "subscriptionCount",
  "successCount",
  "temporaryFailureCount",
  "watchlists",
]);
const SAFE_IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/u;

function safeIdentifier(value: unknown, fallback?: string): string | undefined {
  return typeof value === "string" && SAFE_IDENTIFIER.test(value) ? value : fallback;
}

function sanitizeWorkerRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === "error" || key === "err" || key === "errorName") {
      sanitized[key === "errorName" ? "errorName" : key] = safeError(value);
    } else if (STRING_FIELDS.has(key)) {
      const safe = safeIdentifier(value);
      if (safe !== undefined) sanitized[key] = safe;
    } else if (NUMBER_FIELDS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      sanitized[key] = value;
    } else if (key === "queues" && Array.isArray(value)) {
      sanitized.queues = value.map((item) => safeIdentifier(item)).filter(Boolean);
    }
  }
  return sanitized;
}

function sanitizeWorkerBindings(bindings: Record<string, unknown>): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const key of ["environment", "release", "service"] as const) {
    const safe = safeIdentifier(bindings[key]);
    if (safe !== undefined) base[key] = safe;
  }
  return { ...base, ...sanitizeWorkerRecord(bindings) };
}

export function createWorkerLogger(destination?: DestinationStream, level?: string): Logger {
  const configuredLevel = process.env.LOG_LEVEL?.toLowerCase();
  const options: LoggerOptions = {
    base: {
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.ATHENVIA_IMAGE_TAG ?? "local",
      service: "athenvia-worker",
    },
    level:
      level ??
      (configuredLevel && LOG_LEVELS.has(configuredLevel)
        ? configuredLevel
        : process.env.NODE_ENV === "test"
          ? "silent"
          : "info"),
    messageKey: "message",
    formatters: {
      bindings: sanitizeWorkerBindings,
      log: sanitizeWorkerRecord,
    },
    mixin(_context, level) {
      return level >= ERROR_LEVEL ? { eventId: randomUUID() } : {};
    },
    redact: {
      censor: "[REDACTED]",
      paths: REDACTED_PATHS,
    },
    serializers: {
      err: safeError,
      error: safeError,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  return destination ? pino(options, destination) : pino(options);
}

export function jobCorrelationFields(
  queue: string,
  job: { attemptsMade: number; id?: string; name: string },
  phase: "active" | "settled" = "active",
): Record<string, number | string> {
  const safeQueue = safeIdentifier(queue, "unknown") ?? "unknown";
  const jobId = safeIdentifier(job.id, "unknown") ?? "unknown";
  const jobName = safeIdentifier(job.name, "unknown") ?? "unknown";
  return {
    attempt: phase === "active" ? job.attemptsMade + 1 : Math.max(1, job.attemptsMade),
    correlationId: `${safeQueue}:${jobId}`,
    jobId,
    jobName,
    queue: safeQueue,
  };
}
