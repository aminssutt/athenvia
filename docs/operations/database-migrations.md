# Production database migrations

This runbook is the release procedure for every Athenvia change that touches
`packages/database/prisma/schema.prisma`, a migration SQL file, seed data, or
code that assumes a new database shape.

The production database is never migrated from a developer laptop. Dokploy
runs the versioned `migrate` service from `docker-compose.prod.yml`; that
service applies committed migrations and the idempotent catalogue seed before
the new web and worker containers start.

## Non-negotiable rules

- Treat the files in `packages/database/prisma/migrations` as immutable after
  they have reached production.
- Use `prisma migrate deploy` in production. Never use `migrate dev`,
  `migrate reset`, or `db push` there.
- Prefer expand/contract changes that remain compatible with both the previous
  and next application release.
- Never rely on a Docker volume snapshot as the only backup.
- Never mark a failed migration applied or rolled back until its real database
  effects have been inspected and a migration reviewer has approved the action.
- Do not deploy two database releases concurrently.

Prisma's production command applies pending migrations but does not detect
schema drift. The preflight and post-deploy checks below are therefore part of
the release, not optional diagnostics.

## Release record

Before starting, record these values in the release or incident notes:

| Field                    | Required value                                      |
| ------------------------ | --------------------------------------------------- |
| Release Git SHA          | Exact commit being deployed                         |
| Previous healthy SHA     | Last production commit known to work                |
| Migration names          | Every new migration directory, in application order |
| Migration classification | Additive, contract, data rewrite, or destructive    |
| Backup location          | Off-server object/path and checksum                 |
| Operator                 | Person running the release                          |
| Start time               | UTC timestamp                                       |

## Command context

Run the commands from the exact Dokploy checkout and environment that own the
production stack. Keep one shell open for the procedure and define:

```bash
set -euo pipefail
export ATHENVIA_PROJECT="DOKPLOY_COMPOSE_PROJECT"
export ATHENVIA_COMPOSE_FILE="/absolute/path/to/docker-compose.prod.yml"
export RELEASE_SHA="EXACT_RELEASE_COMMIT"
export PREVIOUS_SHA="EXACT_PREVIOUS_HEALTHY_COMMIT"

athenvia_compose() {
  docker compose \
    --project-name "$ATHENVIA_PROJECT" \
    --file "$ATHENVIA_COMPOSE_FILE" \
    "$@"
}

athenvia_compose ps postgres
```

Use the project name shown by the Dokploy deployment, not `athenvia` or a name
invented for the command. The final check must show the existing production
PostgreSQL container. Stop if it creates a project, cannot render the production
environment, or does not list that container.

The Dokploy environment variables must already be exported in this shell. Do
not copy production secrets to a developer machine or place them in the Git
checkout.

## 1. Preflight

### Inspect the exact change

Compare the release with the previous healthy SHA:

```bash
git diff "$PREVIOUS_SHA..$RELEASE_SHA" -- \
  packages/database/prisma/schema.prisma \
  packages/database/prisma/migrations \
  data/seed
```

Confirm that:

- every schema change has committed migration SQL;
- no previously released migration was edited, renamed, or deleted;
- data backfills are bounded, restartable, and safe to run twice;
- indexes on large tables avoid an unacceptable blocking lock;
- the old application can still run while the migration is in progress;
- the new application can tolerate the pre-migration shape until deployment
  ordering hands control to it.

Run the normal CI suite and replay the full migration history against an empty
PostgreSQL database. Test the upgrade from a recent production-like backup for
any data rewrite, constraint tightening, column type change, or large index.

### Classify the migration

| Class        | Examples                                                         | Release rule                                             |
| ------------ | ---------------------------------------------------------------- | -------------------------------------------------------- |
| Additive     | Nullable column, new table, compatible index                     | Normal deployment                                        |
| Contract     | Removing an old column/index after callers stopped using it      | Separate release after compatibility is proven           |
| Data rewrite | Backfill, type conversion, deduplication                         | Verified backup and production-like timing test required |
| Destructive  | Drop/truncate, irreversible transform, stricter lossy constraint | Verified backup, explicit approval, maintenance plan     |

Split an incompatible change into releases:

1. Expand the schema while retaining the old shape.
2. Deploy code that reads the new shape and remains compatible with the old one.
3. Backfill and verify the data.
4. Remove the obsolete shape in a later reviewed release.

If expand/contract is impossible, schedule a maintenance window and stop the
web and worker before applying the migration.

### Check production migration status

Run this with the image from the current healthy production deployment:

```bash
athenvia_compose run --rm --no-deps migrate \
  ./packages/database/node_modules/.bin/prisma migrate status \
  --schema=packages/database/prisma/schema.prisma
```

Stop if Prisma reports a failed migration, divergent history, a missing
migration, a pending migration in the current healthy release, or a database
connection error. Do not deploy on top of an unexplained state.

`migrate status` also exits `1` for an ordinary pending migration. If the
candidate `RELEASE_SHA` image is intentionally used instead, run that diagnostic
in a separate shell because the expected exit code is `1`. Its pending list must
contain exactly the new migration names recorded for this release; any other
difference blocks deployment.

## 2. Back up before risk

A verified backup is mandatory for data rewrites, contract migrations, and
destructive migrations. It is recommended for every database release.

Create a private custom-format dump on the deployment host. `BACKUP_DIR` must be
an absolute directory outside every Git checkout and Docker build context:

```bash
set -euo pipefail
umask 077

BACKUP_DIR="/srv/backups/athenvia"
install -d -m 0700 "$BACKUP_DIR"
BACKUP_BUNDLE="$BACKUP_DIR/athenvia-$(date -u +%Y%m%dT%H%M%S%N)-${PREVIOUS_SHA}"
BACKUP_TEMP_DIR="$(mktemp -d "$BACKUP_DIR/.athenvia-backup-XXXXXX")"
trap '[[ "$BACKUP_TEMP_DIR" == "$BACKUP_DIR"/.athenvia-backup-* ]] && \
  rm -rf -- "$BACKUP_TEMP_DIR"' EXIT

athenvia_compose exec -T postgres sh -ceu \
  'pg_dump --format=custom --no-owner --no-privileges \
    --username="$POSTGRES_USER" "$POSTGRES_DB"' \
  > "$BACKUP_TEMP_DIR/database.dump"

athenvia_compose exec -T postgres \
  pg_restore --list < "$BACKUP_TEMP_DIR/database.dump" >/dev/null

(cd "$BACKUP_TEMP_DIR" && sha256sum database.dump > SHA256SUMS)
[[ ! -e "$BACKUP_BUNDLE" ]]
mv -T "$BACKUP_TEMP_DIR" "$BACKUP_BUNDLE"
trap - EXIT
printf 'Backup bundle: %s\n' "$BACKUP_BUNDLE"
```

The final directory appears only after both `database.dump` and `SHA256SUMS`
exist, and its nanosecond timestamp prevents a retry from overwriting an earlier
backup. Copy the complete directory to storage outside the server. Record its
location in the release notes.

For a destructive change, prove the dump is restorable before migrating. Use a
disposable PostgreSQL 16 instance on a separate restore host with enough free
space for the restored database. Never perform this drill in the production
cluster or its Docker volume.

On the disposable restore host, after securely copying `BACKUP_BUNDLE` there:

```bash
set -euo pipefail
export BACKUP_BUNDLE="/absolute/path/to/copied/backup-bundle"
export BACKUP="$BACKUP_BUNDLE/database.dump"
export RESTORE_CONTAINER="athenvia-restore-check-$(date -u +%Y%m%dT%H%M%S)-$$"
export RESTORE_PASSWORD="$(openssl rand -hex 32)"

(cd "$BACKUP_BUNDLE" && sha256sum --check SHA256SUMS)
! docker container inspect "$RESTORE_CONTAINER" >/dev/null 2>&1

docker run --detach --name "$RESTORE_CONTAINER" \
  --env POSTGRES_PASSWORD="$RESTORE_PASSWORD" \
  postgres:16-alpine >/dev/null

trap 'docker rm --force "$RESTORE_CONTAINER" >/dev/null 2>&1 || true' EXIT
RESTORE_READY=false
for _ in $(seq 1 60); do
  if docker exec "$RESTORE_CONTAINER" \
    pg_isready --username=postgres --dbname=postgres >/dev/null; then
    RESTORE_READY=true
    break
  fi
  sleep 1
done

if [[ "$RESTORE_READY" != true ]]; then
  docker logs "$RESTORE_CONTAINER"
  exit 1
fi

docker exec "$RESTORE_CONTAINER" \
  createdb --username=postgres athenvia_restore_check

docker exec --interactive "$RESTORE_CONTAINER" \
  pg_restore --exit-on-error --no-owner --no-privileges \
    --username=postgres --dbname=athenvia_restore_check < "$BACKUP"

docker exec "$RESTORE_CONTAINER" \
  psql --username=postgres --dbname=athenvia_restore_check \
    --command="SELECT COUNT(*) FROM _prisma_migrations;"

docker rm --force "$RESTORE_CONTAINER" >/dev/null
trap - EXIT
unset RESTORE_PASSWORD
```

The scheduled Dokploy backup, retention policy, and recurring restore drill are
defined in [`backups.md`](./backups.md). The manual steps above remain required
immediately before a destructive migration.

## 3. Apply the forward migration

1. Confirm the Dokploy deployment points to `RELEASE_SHA` (or a release branch
   fixed at that SHA), and keep `PREVIOUS_SHA` available.
2. Start one deployment. Do not start a second deployment while `migrate` is
   running.
3. Watch the `migrate` service logs.
4. Require exit code `0`. The service must finish `prisma migrate deploy` and
   the seed before Dokploy starts the new web and worker containers.
5. Stop the release immediately if `migrate` exits non-zero. Do not bypass the
   dependency or manually start the new application containers.

Prisma uses a database advisory lock for production migration commands. A lock
timeout is not permission to disable the lock; confirm no other migration is
running, then retry one deployment.

## 4. Verify after migration

Complete every check before declaring the release healthy:

```bash
athenvia_compose run --rm --no-deps migrate \
  ./packages/database/node_modules/.bin/prisma migrate status \
  --schema=packages/database/prisma/schema.prisma
```

Then verify:

- the expected migrations have a non-null `finished_at` and no unresolved
  failure in PostgreSQL's `_prisma_migrations` table;
- `GET https://YOUR_DOMAIN/api/health` returns `200 {"status":"ok"}`;
- the web and worker containers are running without restart loops;
- the worker logs `Athenvia worker is ready` and completes its safety sweep;
- sign-in, catalogue search, one programme detail, and the changed workflow
  succeed;
- any migration-specific row counts, constraints, and backfill invariants match
  the values written in the migration review.

Observe error rate, database locks, CPU, storage, and slow queries during the
release window. Record the completion time and result in the release notes.

## 5. Rollback decision matrix

Database rollback is a recovery decision, not an automatic down migration.

| Situation                                       | Recovery action                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| Application regression; schema still compatible | Deploy `PREVIOUS_SHA`; leave the additive migration in place                       |
| Migration failed before completion              | Keep new web/worker stopped; inspect logs and `_prisma_migrations`; repair forward |
| Applied migration is wrong but data is intact   | Create and review a new forward repair migration, then deploy a new SHA            |
| Destructive migration lost or corrupted data    | Restore the verified backup into a new database, validate it, then cut over        |
| Production received a reviewed manual hotfix    | Reconcile code and history with a reviewed migration and `migrate resolve`         |

If Dokploy cannot select a commit directly, create a temporary protected release
branch at `PREVIOUS_SHA` and deploy that branch. Do not force-push `main`.

### Recover a failed Prisma migration

First collect:

- the complete `migrate` container log;
- the failed row and `logs` value from `_prisma_migrations`;
- the actual tables, columns, constraints, and data affected;
- the release SHA and migration name.

Choose one reviewed path:

1. Undo any partial database effects, mark only that failed migration rolled
   back, correct the migration in a new release, and redeploy.
2. Manually complete the intended SQL, verify the end state, then mark only that
   failed migration applied.

`prisma migrate resolve` changes migration history; it does not undo SQL. Run it
only after the database state matches the chosen path:

```bash
export MIGRATION_NAME="EXACT_FAILED_MIGRATION_DIRECTORY"

athenvia_compose run --rm --no-deps migrate \
  ./packages/database/node_modules/.bin/prisma migrate resolve \
  --rolled-back "$MIGRATION_NAME" \
  --schema=packages/database/prisma/schema.prisma
```

Use `--applied "$MIGRATION_NAME"` only when the migration's intended SQL has
already been completed and verified. A migration reviewer must approve either
command.

### Restore after destructive data loss

1. Stop web and worker writes.
2. Keep the damaged database unchanged for investigation.
3. Create a separate PostgreSQL database.
4. Restore the verified dump with `pg_restore --exit-on-error`.
5. Run migration status, integrity queries, and application smoke tests against
   the restored database.
6. Change the Dokploy `POSTGRES_DB` value to the restored database and redeploy
   the last compatible SHA.
7. Preserve logs, checksums, timestamps, and the damaged database until the
   incident review is complete.

Do not restore over the only production copy unless there is no safer recovery
path and the action has explicit approval.

## References

- [Prisma production migration workflow](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production)
- [`prisma migrate deploy`](https://docs.prisma.io/docs/cli/migrate/deploy)
- [`prisma migrate status`](https://www.prisma.io/docs/cli/migrate/status)
- [`prisma migrate resolve`](https://docs.prisma.io/docs/cli/migrate/resolve)
- [Prisma production hotfix and failed-migration recovery](https://docs.prisma.io/docs/orm/prisma-migrate/workflows/patching-and-hotfixing)
