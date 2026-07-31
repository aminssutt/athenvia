#!/usr/bin/env bash

# Never enable xtrace in this script: the restore password is intentionally
# short-lived and must not appear in CI, Dokploy, or operator logs.
set +x
set -Eeuo pipefail
IFS=$'\n\t'

usage() {
  printf 'Usage: %s /absolute/path/to/backup.sql.gz\n' "$0" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

backup_path="$1"
postgres_image="postgres:16-alpine@sha256:4e6e670bb069649261c9c18031f0aded7bb249a5b6664ddec29c013a89310d50"
timeout_seconds="${RESTORE_TIMEOUT_SECONDS:-60}"
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
migrations_dir="$script_dir/../packages/database/prisma/migrations"

if [[ ! -f "$backup_path" || ! -r "$backup_path" || ! -s "$backup_path" ]]; then
  printf 'Backup must be a readable, non-empty file: %s\n' "$backup_path" >&2
  exit 2
fi

if [[ ! "$timeout_seconds" =~ ^[1-9][0-9]*$ ]]; then
  printf 'RESTORE_TIMEOUT_SECONDS must be a positive integer.\n' >&2
  exit 2
fi

if [[ ! -d "$migrations_dir" ]]; then
  printf 'Prisma migrations directory is unavailable.\n' >&2
  exit 2
fi

expected_latest_migration="$(
  find "$migrations_dir" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' |
    LC_ALL=C sort |
    tail -n 1
)"
if [[ ! "$expected_latest_migration" =~ ^[0-9]{14}_[a-z0-9_]+$ ]]; then
  printf 'Unable to determine the expected latest Prisma migration.\n' >&2
  exit 2
fi

for command_name in docker openssl; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$command_name" >&2
    exit 2
  fi
done

backup_is_gzip=false
if [[ "$backup_path" == *.gz ]]; then
  backup_is_gzip=true
  if ! command -v gzip >/dev/null 2>&1; then
    printf 'Required command is unavailable: gzip\n' >&2
    exit 2
  fi
  gzip --test -- "$backup_path"
fi

container_name="athenvia-restore-$(date -u +%Y%m%dT%H%M%S)-$$-${RANDOM}"
restore_password="$(openssl rand -hex 32)"
restore_error_path="$(mktemp "${TMPDIR:-/tmp}/athenvia-restore-error.XXXXXX")"
chmod 600 "$restore_error_path"
container_created=false

cleanup() {
  if [[ "$container_created" == true ]]; then
    docker rm --force "$container_name" >/dev/null 2>&1 || true
  fi
  rm --force -- "$restore_error_path"
  restore_password=""
}

trap cleanup EXIT

if docker container inspect "$container_name" >/dev/null 2>&1; then
  printf 'Refusing to reuse an existing restore container.\n' >&2
  exit 1
fi

docker run --detach \
  --name "$container_name" \
  --network none \
  --log-driver none \
  --cpus 2 \
  --memory 2g \
  --pids-limit 256 \
  --env "POSTGRES_PASSWORD=$restore_password" \
  "$postgres_image" >/dev/null
container_created=true

restore_ready=false
for ((attempt = 1; attempt <= timeout_seconds; attempt += 1)); do
  if docker exec "$container_name" \
    pg_isready --username=postgres --dbname=postgres >/dev/null 2>&1; then
    restore_ready=true
    break
  fi
  sleep 1
done

if [[ "$restore_ready" != true ]]; then
  printf 'Disposable PostgreSQL did not become ready within %s seconds.\n' \
    "$timeout_seconds" >&2
  exit 1
fi

stream_backup() {
  if [[ "$backup_is_gzip" == true ]]; then
    gzip --decompress --stdout -- "$backup_path"
  else
    command cat -- "$backup_path"
  fi
}

# Never emit pg_restore diagnostics: a failed COPY can include restored row data.
if ! stream_backup | docker exec --interactive "$container_name" \
  pg_restore --list >/dev/null 2>"$restore_error_path"; then
  printf 'Backup archive validation failed; diagnostics were suppressed.\n' >&2
  exit 1
fi

docker exec "$container_name" \
  createdb --username=postgres athenvia_restore_check

if ! stream_backup | docker exec --interactive "$container_name" \
  pg_restore \
    --exit-on-error \
    --no-owner \
    --no-privileges \
    --username=postgres \
    --dbname=athenvia_restore_check \
    >/dev/null 2>"$restore_error_path"; then
  printf 'Backup restoration failed; diagnostics were suppressed.\n' >&2
  exit 1
fi

psql_scalar() {
  local query="$1"
  docker exec "$container_name" \
    psql \
      --username=postgres \
      --dbname=athenvia_restore_check \
      --tuples-only \
      --no-align \
      --set=ON_ERROR_STOP=1 \
      --command="$query"
}

migration_count="$(
  psql_scalar \
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL;'
)"
failed_migration_count="$(
  psql_scalar \
    'SELECT COUNT(*) FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL;'
)"
latest_migration_count="$(
  psql_scalar \
    "SELECT COUNT(*) FROM \"_prisma_migrations\" WHERE migration_name = '$expected_latest_migration' AND finished_at IS NOT NULL AND rolled_back_at IS NULL;"
)"
application_table_count="$(
  psql_scalar \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('users', 'accounts', 'sessions', 'verification_tokens', 'universities', 'university_aliases', 'programs', 'domains', 'program_domains', 'intakes', 'application_windows', 'sources', 'program_summaries', 'source_snapshots', 'data_revisions', 'user_watchlists', 'notification_preferences', 'push_subscriptions', 'notification_deliveries', 'university_submissions', 'program_submissions');"
)"
university_count="$(
  psql_scalar 'SELECT COUNT(*) FROM universities;'
)"
program_count="$(
  psql_scalar 'SELECT COUNT(*) FROM programs;'
)"
user_count="$(
  psql_scalar 'SELECT COUNT(*) FROM users;'
)"
watchlist_count="$(
  psql_scalar 'SELECT COUNT(*) FROM user_watchlists;'
)"
push_subscription_count="$(
  psql_scalar 'SELECT COUNT(*) FROM push_subscriptions;'
)"
notification_delivery_count="$(
  psql_scalar 'SELECT COUNT(*) FROM notification_deliveries;'
)"

if ((migration_count < 1)); then
  printf 'Restore contains no Prisma migration history.\n' >&2
  exit 1
fi

if ((failed_migration_count != 0)); then
  printf 'Restore contains unresolved failed migrations: %s\n' \
    "$failed_migration_count" >&2
  exit 1
fi

if ((latest_migration_count != 1)); then
  printf 'Restore does not include the expected latest Prisma migration.\n' >&2
  exit 1
fi

if ((application_table_count != 21)); then
  printf 'Restore is missing one or more Athenvia application tables.\n' >&2
  exit 1
fi

if ((university_count < 1 || program_count < 1)); then
  printf 'Restore contains no usable catalogue data.\n' >&2
  exit 1
fi

docker rm --force "$container_name" >/dev/null
container_created=false
rm --force -- "$restore_error_path"
restore_error_path=""
restore_password=""
trap - EXIT

printf 'Backup restoration verified.\n'
printf 'Applied migrations: %s\n' "$migration_count"
printf 'Application tables: %s\n' "$application_table_count"
printf 'Catalogue universities: %s\n' "$university_count"
printf 'Catalogue programs: %s\n' "$program_count"
printf 'Users: %s\n' "$user_count"
printf 'Watchlists: %s\n' "$watchlist_count"
printf 'Push subscriptions: %s\n' "$push_subscription_count"
printf 'Notification deliveries: %s\n' "$notification_delivery_count"
