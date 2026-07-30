# Immutable source snapshots

`source_snapshots` is append-only evidence. A snapshot stores a source ID,
canonical SHA-256 hash, deterministic object-storage key and capture time. Raw
content belongs in immutable object storage, never PostgreSQL or Redis.

## Invariants

- `(source_id, content_hash)` is unique, so repeated and concurrent captures of
  identical bytes resolve to one snapshot per source.
- `storage_key` is globally unique and contains only a source UUID plus a
  server-derived digest.
- database triggers reject snapshot updates and deletes;
- the snapshot foreign key uses `RESTRICT`, so its source cannot be deleted;
- university/program links on a source cannot be reassigned after evidence
  exists.

`recordSourceSnapshot` is the only application write path. It never accepts raw
content and only advances `sources.content_hash` when the capture timestamp is
newer than `sources.last_checked_at`.

## Migration review and preflight

Before applying `20260730170000_enforce_immutable_source_snapshots` in an
environment that may already contain snapshots, both queries must return no
rows:

```sql
SELECT source_id, content_hash, count(*)
FROM source_snapshots
GROUP BY source_id, content_hash
HAVING count(*) > 1;

SELECT storage_key, count(*)
FROM source_snapshots
GROUP BY storage_key
HAVING count(*) > 1;
```

If duplicates exist, do not delete evidence automatically. Quarantine the
deployment, compare the referenced immutable objects, and prepare an explicitly
reviewed reconciliation migration.

The migration is backward-incompatible for code that updates/deletes snapshots,
deletes snapshotted sources, or changes their university/program links. Deploy
all writers before applying it. Rollback requires disabling the two triggers,
dropping their functions and unique indexes, then restoring the original
`ON DELETE CASCADE` foreign key; that weakens evidence guarantees and requires a
security review.
