# Athenvia worker queues

The verification pipeline uses four separate BullMQ queues:

| Queue       | Job name                    | Payload                |
| ----------- | --------------------------- | ---------------------- |
| `discovery` | `discover-official-source`  | `{ submissionId }`     |
| `fetch`     | `fetch-official-source`     | `{ sourceId }`         |
| `parse`     | `parse-source-snapshot`     | `{ sourceSnapshotId }` |
| `review`    | `queue-verification-review` | `{ revisionId }`       |

Payloads contain UUID identifiers only. Processors must load mutable URLs, source
content, snapshots and revisions from PostgreSQL when the job runs. This keeps jobs
small, prevents stale content from being retried and avoids storing sensitive or
untrusted content in Redis.

Use `addDiscoveryJob`, `addFetchJob`, `addParseJob` and `addReviewJob` from
`src/queues.ts`. These helpers validate payloads before adding them.

## Retry and retention policy

Verification jobs receive four total attempts with BullMQ's exponential backoff:
2 seconds, 4 seconds and 8 seconds between retries.

- completed verification jobs: retained up to 24 hours or 1,000 jobs;
- failed source jobs: retained up to 30 days or 5,000 jobs;
- dead-letter records: retained up to 90 days or 10,000 jobs.

The worker listens for permanent failures and exhausted retries. A final failure is
copied to `verification-dead-letter` under a deterministic job ID, with the same
validated ID-only payload. The dead-letter worker records the stage and stable
identifier, then completes the record so BullMQ can enforce age and count retention.
The original failed job remains available for diagnosis during its retention window.

## Notification delivery

The `notifications` queue accepts only the strict job payload
`{ deliveryId: UUID }` under job name `deliver-notification`. BullMQ `jobId`
equals the delivery ID, and notification jobs have exactly one BullMQ attempt. URLs,
copy, Web Push endpoints, encryption keys and VAPID material never enter Redis.
The processor reloads all mutable delivery state and active subscriptions from
PostgreSQL.

A startup safety sweep and five-minute recurring sweep create/reconcile opening
and deadline reminder rows. A separate 30-second dispatcher queues bounded due
`SCHEDULED` delivery IDs. Both loops reject overlap and are awaited during
shutdown. Date-change delivery planning remains tied to the canonical
publication/admin integration documented in `src/notifications/README.md`; this
worker does not bypass that missing publication step.

Delivery uses a compare-and-set state machine:

1. `SCHEDULED -> PROCESSING` stores
   `claim:v1:<token>:<claimedAt>:CLAIMED` in `errorMessage`.
2. The processor reloads the delivery, revalidates its reminder/date-change
   invariants, and loads active subscriptions.
3. Immediately before the first network call, an exact fencing CAS replaces
   `CLAIMED` with the same marker ending in `SENDING`.
4. Finalization requires the exact delivery ID, `PROCESSING` state and current
   marker. At least one successful endpoint produces `SENT`; total unresolved
   failure produces `FAILED`; stale data, zero endpoints or only invalid
   endpoints produces `CANCELLED`. `sentAt` is written only for `SENT`.

Concurrent jobs still produce one claim: only one can enter `PROCESSING`, and a
changed fence before `SENDING` prevents every send. The 30-second dispatcher
loop also scans a bounded set of `PROCESSING` claims. A `CLAIMED` marker older
than five minutes is reset to `SCHEDULED` with an exact-marker compare-and-set
because no network request started. A stale `SENDING` marker is instead
quarantined as `FAILED`: the push service may have accepted the request, so
retrying it could duplicate a notification. Invalid processing markers are
quarantined in the same durable, observable state.

Multi-device sends retry only the endpoint that returned an explicit temporary
HTTP response. There are at most three attempts with two- and four-second
backoffs. `408`, `425`, `429` and `5xx` responses are temporary. `404` and
`410` permanently invalidate an endpoint and soft-revoke its database record
without retry. Other HTTP failures are permanent delivery failures. A failure
without an HTTP response is indeterminate and is not retried because acceptance
by the push service cannot be ruled out.

Partial success remains terminal `SENT`, so an already successful endpoint is
never sent the event again. If all endpoints are invalid, the delivery becomes
`CANCELLED`; otherwise total failure becomes `FAILED`. Failed rows are durable
notification dead letters, while partial failures are recorded on the `SENT`
row. Both produce structured logs containing only delivery IDs and aggregate
classification counts, never error bodies, headers, endpoints,
subscription/VAPID keys or raw transport errors.

BullMQ removes a notification job after completion or failure. PostgreSQL remains
the delivery authority through the state and fencing checks above; removing the
queue record lets a deliberately reactivated `CANCELLED` reminder reuse its
stable delivery ID without being blocked by a retained BullMQ job.

The Web Push transport uses a 15-minute TTL, normal urgency, a ten-second socket
timeout and a deterministic SHA-256 base64url topic capped at 32 characters.
Unit tests inject the transport and VAPID configuration; real keys are required
only for an explicit physical-device smoke test.
