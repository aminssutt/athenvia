# Production backups and restoration drills

Athenvia uses Dokploy's native Docker Compose PostgreSQL backup to send logical
database dumps to private S3-compatible storage. This keeps backup scheduling,
retention, and destination credentials outside the application containers and
avoids adding a second backup daemon to the production stack.

PostgreSQL is the recovery source for catalogue records, accounts, sessions,
watchlists, notification preferences, push subscriptions, deliveries, and
migration history. Redis contains transient queues and rate-limit state; it is
not a recovery source and is intentionally excluded.

## Recovery objectives

| Objective            | Production policy                                        |
| -------------------- | -------------------------------------------------------- |
| Recovery point (RPO) | At most 6 hours of database changes                      |
| Recovery time (RTO)  | Restore and validate within 60 minutes                   |
| Schedule             | `17 */6 * * *` with the Dokploy server configured in UTC |
| Retention            | Latest 120 backups, approximately 30 days                |
| Restore drill        | Monthly and before every destructive migration           |
| Backup destination   | Private S3-compatible bucket outside the Dokploy server  |

Configure the Dokploy server timezone as UTC before enabling the schedule; this
avoids a seven-hour recovery gap during a daylight-saving clock change. The
six-hour schedule starts at minute 17 to avoid the common top-of-hour load
spike. An immediate manual backup is also required before a destructive
migration or incident response action.

## S3 destination

Create a dedicated destination in **Dokploy > Settings > Destinations**:

- name: `athenvia-production-backups`;
- bucket: a private bucket used only for backups;
- prefix: `athenvia/production/postgres`;
- region and endpoint: the values from the S3-compatible provider;
- credentials: a dedicated machine identity restricted to read, write, list,
  and delete only that bucket/prefix.

Enable provider-side encryption, versioning or object lock when available, and
a lifecycle rule that expires objects only after the 30-day application
retention window. Keep the destination in another failure domain from the
Dokploy server.

Store S3 credentials only in Dokploy's destination settings. Do not add them to
the repository, root `.env`, Compose environment, a scheduled command, or a
ticket.

Use Dokploy's destination **Test** action before configuring the backup. A test
must succeed without displaying the access key or secret key in the UI or
server logs. If a credential appears in a log, delete the log where possible,
rotate the credential immediately, and block launch until the leak is fixed.

## Dokploy Compose backup

In the Athenvia Docker Compose service, open **Backups** and create one enabled
database backup:

| Dokploy field     | Value                          |
| ----------------- | ------------------------------ |
| Backup type       | Compose                        |
| Database type     | PostgreSQL                     |
| Service name      | `postgres`                     |
| Database          | the production `POSTGRES_DB`   |
| Schedule          | `17 */6 * * *`                 |
| Destination       | `athenvia-production-backups`  |
| Prefix            | `athenvia/production/postgres` |
| Keep latest count | `120`                          |
| Enabled           | Yes                            |

Do not change `COMPOSE_PROJECT_NAME`; Dokploy uses its generated project name
to find the `postgres` service.

After saving:

1. Trigger **Manual Backup**.
2. Require a successful Dokploy job.
3. Confirm that a non-empty `.sql.gz` object exists under the expected prefix.
4. Confirm the object timestamp is current and the bucket is not public.
5. Inspect the backup job log for secret values before treating the schedule as
   active.
6. Verify the next scheduled run within six hours.

Dokploy's application/database backup is required even if a named-volume
snapshot is also enabled. A PostgreSQL logical dump is portable and
consistency-aware; a live copy of `postgres_data` is not its replacement.

## Log safety

Backup and drill logs may contain only:

- start/end timestamps;
- object path or opaque backup ID;
- byte size and checksum;
- success/failure state;
- aggregate migration and catalogue counts.

They must never contain database URLs, PostgreSQL passwords, S3 access keys,
S3 secret keys, Auth.js secrets, VAPID keys, SQL row contents, email addresses,
push endpoints, or dump bytes.

Never enable `set -x`, shell tracing, or command echoing around backup jobs. The
checked-in verification script disables xtrace before generating its temporary
restore password and prints only aggregate counts.

## Monthly restoration drill

Run the drill on a disposable host with enough free disk space. Never restore a
test backup into the production PostgreSQL cluster or its Docker volume.

1. Select the newest successful object in S3.
2. Download it over TLS to a private directory on the disposable host.
3. Record the object key, size, last-modified time, and provider checksum.
4. Run:

   ```bash
   scripts/verify-postgres-backup.sh \
     /absolute/private/path/to/athenvia-backup.sql.gz
   ```

5. Require exit code `0`, the latest migration from the checked-out release,
   zero unresolved failed migrations, all 21 application tables, and usable
   catalogue data.
6. Confirm the disposable container was removed.
7. Delete the local backup copy securely according to the host policy.
8. Record the drill date, backup object, duration, migration count, catalogue
   count, operator, and result. Do not paste database rows or secrets.

The script accepts Dokploy's gzip-compressed custom PostgreSQL dump and the
uncompressed custom dump produced by the migration runbook. It creates a
short-lived PostgreSQL 16 container from a pinned official image. The container
has no network and no Docker log driver. The script validates the archive,
restores into a new database, checks the recovery invariants, and removes the
container on success or failure.

## Failure handling

- One missed backup: trigger a manual backup and investigate before the next
  scheduled window.
- Two consecutive failures or no object younger than 6 hours: treat the backup
  system as degraded, alert the operator, and block destructive migrations.
- Exposed credential: rotate it immediately, update the Dokploy destination,
  test again, and review bucket access logs.
- Failed restore drill: preserve only safe diagnostics, open a P0 incident, and
  do not count subsequent backups as recovery-ready until a drill succeeds.
- Retention below 120 objects: inspect lifecycle and Dokploy retention settings
  before deleting anything manually.

## Launch and recurring checklist

Before launch:

- [ ] S3 destination test succeeds.
- [ ] Manual Compose PostgreSQL backup succeeds.
- [ ] The first object exists in the private prefix.
- [ ] Backup logs contain no secrets.
- [ ] `scripts/verify-postgres-backup.sh` succeeds with that object.
- [ ] The next scheduled backup runs automatically.

Every day, confirm the newest object is less than 6 hours old. Every month, run
and record a restoration drill. Review RPO, RTO, retention, bucket policy, and
credential scope every quarter.

## References

- [Dokploy Compose services and backups](https://docs.dokploy.com/docs/core/docker-compose)
- [Dokploy database backups](https://docs.dokploy.com/docs/core/databases/backups)
- [Dokploy database restore](https://docs.dokploy.com/docs/core/databases/restore)
- [Dokploy S3 destinations](https://docs.dokploy.com/docs/core/actions)
