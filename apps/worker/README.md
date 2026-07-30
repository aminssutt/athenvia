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

The existing `notifications` queue keeps its independent five-attempt policy.
