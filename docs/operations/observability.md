# Production observability and alerting

Athenvia writes one JSON object per server event to standard output. Dokploy
collects the web and worker streams without an in-application API key. Errors
receive an opaque `eventId`; stable `event` and `code` fields group repeated
failures, while request and job correlation fields locate one execution.

This baseline deliberately excludes browser telemetry and raw error payloads.
An external error tracker may ingest the same sanitized JSON later, but it must
not receive request bodies, headers, database queries, notification payloads,
or user records.

`LOG_LEVEL` is centralized in the root environment and defaults to `info` in
production Compose. Use `debug` only for a bounded incident window; the same
field and content restrictions still apply.

## Correlation

### Web requests

Next.js Proxy generates a fresh UUID for every `/api/*` request. It replaces
any client-supplied `x-request-id`, passes the generated value to the route, and
returns the same header to the client. A support report can therefore include
the response ID without exposing an account identifier.

Handled 5xx responses emit `web.request_failed`. Unhandled Next.js errors emit
`web.unhandled_request_error` through `instrumentation.ts`. Both include only:

- `service`, `environment`, and `release`;
- `eventId`, `event`, and a stable `code` when applicable;
- `requestId`, HTTP method, and the route template;
- error class name, never its message, stack, or cause;
- the bounded Next.js error digest when one exists.

Do not log the raw path because its query string may contain private values.

### Worker jobs

Each processed BullMQ job uses a logger child with `queue`, `jobName`, `jobId`,
`attempt`, and `correlationId` (`<queue>:<jobId>`). Completion, failure, and
dead-letter events retain those fields. Job data and record identifiers are
never included.

`jobId`, delivery IDs, request IDs, and Next.js digests are pseudonymous rather
than anonymous. Restrict production-log access to the operator account, retain
searchable application logs for at most 30 days, and do not paste raw log lines
into public issues.

## Redaction contract

Application code uses allowlisted logging helpers. Pino redaction is a second
line of defence for fields named `authorization`, `cookie`, `password`,
`secret`, `token`, `privateKey`, `databaseUrl`, `redisUrl`, `email`, `endpoint`,
`url`, `headers`, `body`, `payload`, or `job.data`. Error serializers retain
only the error class name.

Never log:

- database or Redis URLs and passwords;
- Auth.js secrets, cookies, session tokens, magic links, OAuth credentials, or
  email addresses;
- VAPID private keys, Web Push endpoints, `p256dh`, or subscription auth keys;
- request headers or bodies, source document contents, private notes, SQL rows,
  Prisma arguments, or BullMQ job data;
- raw `Error` messages, stacks, causes, or transport responses.

Alert notifications may include `service`, `event`, `code`, `eventId`, and a
request/job correlation ID only. Never forward the complete log line.

## Health and uptime checks

| Check  | URL                      | Success                        | Meaning                              |
| ------ | ------------------------ | ------------------------------ | ------------------------------------ |
| Web    | `GET /api/health`        | `200 {"status":"ok"}`          | Web can reach PostgreSQL and Redis   |
| Worker | `GET /api/health/worker` | `200 {"status":"ok"}`          | Worker heartbeat in Redis is fresh   |
| Either | same endpoint            | `503 {"status":"unavailable"}` | A required dependency is unavailable |

The worker writes a fixed Redis heartbeat every 30 seconds with a 90-second
TTL, but only after its BullMQ workers and queue listeners are ready. Graceful
shutdown deletes it. The worker check measures process/Redis liveness; it does
not prove that a remote push provider is healthy, so dead-letter alerts remain
required.

Keep the existing container health check on `/api/health`. Do not make web
container restarts depend on the worker endpoint: a worker failure must not
restart a healthy web process.

Configure an uptime monitor outside the Dokploy server failure domain:

1. HTTPS request every 60 seconds;
2. five-second timeout;
3. require status `200` and exact JSON status `ok`;
4. alert after three consecutive failures;
5. send a recovery notification after two consecutive successes;
6. monitor both endpoints and the public landing page separately.

Uptime Kuma is suitable and requires no Athenvia application secret. Hosting
the only monitor on the same server is insufficient because it cannot report a
complete server or network outage.

## Required alerts

| Severity | Trigger                                                | Initial response                                  |
| -------- | ------------------------------------------------------ | ------------------------------------------------- |
| P0       | Both health endpoints fail for three checks            | Check host/network, then Dokploy and dependencies |
| P0       | PostgreSQL unavailable or migration failed             | Stop deploys; follow the migration runbook        |
| P1       | Worker health fails while web remains healthy          | Inspect worker readiness, Redis, and restart loop |
| P1       | `worker.job_dead_lettered` or `worker.startup_failed`  | Inspect IDs/codes only; preserve private payloads |
| P1       | Five or more identical web error codes in five minutes | Correlate by route/release and consider rollback  |
| P1       | A service restarts three times in ten minutes          | Inspect resource limits and the first safe event  |
| P1       | No database backup younger than six hours              | Follow the backup failure policy                  |

Route every P0/P1 alert to the operator with the environment, release, service,
trigger, and runbook link. Test failure and recovery notifications before
launch and once per quarter.

## Incident workflow

1. Confirm the alert from a second network when availability is involved.
2. Record the UTC start time, release, service, stable event/code, and opaque
   correlation IDs. Do not copy secrets or user data.
3. Check Dokploy container state and sanitized JSON events around the first
   failure.
4. Roll back only after checking migration compatibility in the database
   migration runbook.
5. Confirm both health endpoints, one worker safety sweep, and the public
   landing page after recovery.
6. Record resolution time and prevention action, then remove any accidentally
   copied private diagnostic data.

## Launch checklist

- [ ] Both endpoints return `200` in production.
- [ ] Stopping the worker makes only `/api/health/worker` return `503` within 90 seconds.
- [ ] Uptime failure and recovery notifications reach the operator.
- [ ] A controlled API failure produces one JSON event with the response request ID.
- [ ] A controlled worker failure retains its job correlation ID without job data.
- [ ] Secret-marker scans of representative web and worker logs are empty.
- [ ] Dokploy log access and the 30-day maximum retention are enforced.

## References

- [Next.js Proxy and request headers](https://nextjs.org/docs/app/getting-started/proxy)
- [Next.js server error instrumentation](https://nextjs.org/docs/pages/api-reference/file-conventions/instrumentation)
- [Pino redaction API](https://github.com/pinojs/pino/blob/main/docs/api.md#redact-array--object)
- [Dokploy Compose service logs](https://docs.dokploy.com/docs/core/docker-compose)
- [Dokploy Uptime Kuma template](https://docs.dokploy.com/docs/templates/uptime-kuma)
