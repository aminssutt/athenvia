import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

import { requestIdFromRequest, validRequestId } from "./request-id";

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
  "req.headers",
  "request.headers",
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

function configuredLogLevel(): string {
  const configured = process.env.LOG_LEVEL?.toLowerCase();
  if (configured && LOG_LEVELS.has(configured)) {
    return configured;
  }
  return process.env.NODE_ENV === "test" ? "silent" : "info";
}

function safeErrorName(value: unknown): string {
  // Accept both raw errors and records already reduced by the pino serializer,
  // which runs before the log formatter re-applies this sanitizer.
  const name =
    value instanceof Error
      ? value.name
      : typeof value === "object" && value !== null && "name" in value
        ? (value as { name: unknown }).name
        : value;
  return typeof name === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u.test(name)
    ? name
    : "UnknownError";
}

function safeError(value: unknown): { name: string } {
  return { name: safeErrorName(value) };
}

function safeCode(value: string): string {
  return /^[A-Z0-9_.-]{1,128}$/u.test(value) ? value : "UNKNOWN_EVENT";
}

function safeString(value: unknown, pattern: RegExp, fallback?: string): string | undefined {
  return typeof value === "string" && pattern.test(value) ? value : fallback;
}

function sanitizeWebRecord(record: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  const code = safeString(record.code, /^[A-Z0-9_.-]{1,128}$/u);
  const component = safeString(record.component, /^[A-Za-z0-9_.-]{1,128}$/u);
  const digest = safeString(record.digest, /^[A-Za-z0-9_-]{1,128}$/u);
  const event = safeString(record.event, /^[a-z][a-z0-9_.-]{1,127}$/u);
  const eventId = safeString(record.eventId, /^[0-9a-f-]{36}$/u);
  const method = safeString(record.method, /^[A-Z]{3,12}$/u);
  const requestId = safeString(record.requestId, /^[0-9a-f-]{36}$/u);
  const route = safeString(record.route, /^[A-Za-z0-9_./[\]-]{1,256}$/u);
  const routeType = safeString(record.routeType, /^[A-Za-z0-9_.-]{1,64}$/u);
  const routerKind = safeString(record.routerKind, /^[A-Za-z0-9_.-]{1,64}$/u);

  if (code) sanitized.code = code;
  if (component) sanitized.component = component;
  if (digest) sanitized.digest = digest;
  if (record.error !== undefined) sanitized.error = safeError(record.error);
  if (record.err !== undefined) sanitized.err = safeError(record.err);
  if (event) sanitized.event = event;
  if (eventId) sanitized.eventId = eventId;
  if (method) sanitized.method = method;
  if (requestId) sanitized.requestId = requestId;
  if (route) sanitized.route = route;
  if (routeType) sanitized.routeType = routeType;
  if (routerKind) sanitized.routerKind = routerKind;
  return sanitized;
}

export function createWebLogger(
  destination?: DestinationStream,
  level = configuredLogLevel(),
): Logger {
  const options: LoggerOptions = {
    base: {
      environment: process.env.NODE_ENV ?? "development",
      release: process.env.ATHENVIA_IMAGE_TAG ?? "local",
      service: "athenvia-web",
    },
    level,
    messageKey: "message",
    formatters: {
      log: sanitizeWebRecord,
    },
    mixin(_context, level) {
      return level >= ERROR_LEVEL ? { eventId: crypto.randomUUID() } : {};
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

const webLogger = createWebLogger();

export function logRequestError(
  request: Pick<Request, "headers" | "method">,
  fields: {
    code: string;
    error?: unknown;
    route: string;
  },
): void {
  webLogger.error(
    {
      code: safeCode(fields.code),
      error: fields.error,
      event: "web.request_failed",
      method: request.method,
      requestId: requestIdFromRequest(request),
      route: fields.route,
    },
    "Web request failed",
  );
}

export function logCapturedRequestError(
  error: unknown,
  request: {
    headers: Record<string, string | string[] | undefined>;
    method: string;
  },
  context: {
    routePath: string;
    routeType: string;
    routerKind: string;
  },
): void {
  const digest =
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/u.test(error.digest)
      ? error.digest
      : undefined;

  webLogger.error(
    {
      digest,
      error,
      event: "web.unhandled_request_error",
      method: request.method,
      requestId: validRequestId(request.headers["x-request-id"]) ?? crypto.randomUUID(),
      route: context.routePath,
      routeType: context.routeType,
      routerKind: context.routerKind,
    },
    "Unhandled web request error captured",
  );
}

export function logOperationalWarning(component: string, code: string): void {
  webLogger.warn(
    { code: safeCode(code), component, event: "web.operational_warning" },
    "Operational fallback active",
  );
}

export function logAuthenticationEvent(level: "error" | "warn", code: string): void {
  webLogger[level](
    { code: safeCode(code), event: "auth.provider_event" },
    "Authentication provider event",
  );
}
