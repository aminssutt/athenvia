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
equals the delivery ID, and notification jobs have exactly one attempt. URLs,
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
   marker. At least one successful endpoint produces `SENT`; zero successes
   produces `FAILED`; stale data or zero endpoints produces `CANCELLED`.
   `sentAt` is written only for `SENT`.

Concurrent jobs therefore produce at most one network attempt: only one can
claim, and a changed fence before `SENDING` prevents every send. There is
deliberately no reclaim of `PROCESSING` in this issue. A process crash after
claim leaves `CLAIMED`; a crash after the network boundary may leave `SENDING`.
The recovery/quarantine policy for these crash gaps belongs to #61, and no
transition back to `SCHEDULED` occurs here.

Multi-device sends use `Promise.allSettled`. Partial success is terminal `SENT`
without retry, because retrying could duplicate delivery to successful devices.
Total failure is terminal `FAILED`. Logs contain only delivery IDs and aggregate
endpoint counts, never endpoints or subscription/VAPID secrets.

BullMQ removes a notification job after completion or failure. PostgreSQL remains
the delivery authority through the state and fencing checks above; removing the
queue record lets a deliberately reactivated `CANCELLED` reminder reuse its
stable delivery ID without being blocked by a retained BullMQ job.

The Web Push transport uses a 15-minute TTL, normal urgency, a ten-second socket
timeout and a deterministic SHA-256 base64url topic capped at 32 characters.
Unit tests inject the transport and VAPID configuration; real keys are required
only for an explicit physical-device smoke test.
