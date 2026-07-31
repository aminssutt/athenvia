# Maintenance scripts

One-off import, verification and maintenance scripts live here. Scripts must be
idempotent where practical, validate inputs, avoid arbitrary network targets and provide
a dry-run mode before changing shared catalogue data.

## Source-backed catalogue import

The maintained catalogue importer lives with the database package so its Prisma
writer and tests are typechecked together:

- `pnpm db:seed:check` validates every `data/seed/p4-NN.json` file without writes;
- `pnpm db:seed` validates and imports the files transactionally;
- append `-- data/seed/<file>.json` to either command to select explicit files.

See `data/seed/README.md` for the v1 provenance, date-status and stable-key
contract. Imports use deterministic identities, serialize through an advisory
lock and never delete records omitted from a later file.

## Backup restoration verification

`verify-postgres-backup.sh /absolute/path/to/backup.sql.gz` restores a Dokploy
PostgreSQL backup into a disposable PostgreSQL 16 container and validates
migration history, every application table and catalogue data without logging
secrets or row contents. The container has no network access and uses a pinned
official image. See `docs/operations/backups.md` for the production schedule,
retention and monthly drill.

## GitHub roadmap automation

- `create-roadmap-issues.ps1` creates the approved issue catalogue idempotently and closes
  the Phase 0 items delivered by the bootstrap.
- `configure-roadmap-project.ps1` adds every issue to the GitHub Project and synchronizes
  Status, Priority, Phase, Workstream, Owner, target milestone and dependency fields.
