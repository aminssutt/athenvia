# Source-backed catalogue seeds

Athenvia seed files use the strict JSON Schema in `seed.schema.json`. The current
format version is `1`; additional properties are rejected so a misspelled field
cannot silently disappear during import.

## Authoring rules

- Give universities, programs, sources, intakes and application windows stable
  lowercase kebab-case keys. Renaming a key changes its deterministic identity.
- Use only reviewed official HTTPS sources. `lastCheckedAt` records when the
  official page was actually checked.
- Give every program a factual 80–800 character `summary` and point
  `summary.sourceKey` at the source supporting that description. The importer
  persists the copy and its official source as one canonical programme summary.
- An application window has one `publicStatus` and one `verification` value for
  both dates because that is the canonical database model.
- `CONFIRMED` therefore requires both exact UTC instants and `OFFICIAL` or
  `VERIFIED` evidence. An incomplete pair must not be labelled confirmed.
- `EXPECTED` and `NOT_PUBLISHED` carry no exact instant. Never turn a month,
  season or historical pattern into an invented day.
- `lastVerifiedAt` cannot be later than the supporting source's
  `lastCheckedAt`.
- Intake start dates are not accepted in v1 because the current model cannot
  attach per-fact provenance to them. Add them only after that provenance path
  exists; the importer never clears an existing canonical start date.
- Do not remove old data merely by omitting it from a later seed file. Seed
  import deliberately never prunes records or relations.

`sample.json` is an executable example, not production catalogue data. Phase 4
records live in `p4-NN.json` files. When at least one such file exists, the
default import selects all of them in lexical order instead of the sample.

## Validate and import

From the repository root:

```bash
pnpm db:seed:check
pnpm db:seed:check -- data/seed/p4-02.json
pnpm db:seed
pnpm db:seed -- data/seed/p4-02.json
```

Dry-run validates schema and cross-reference invariants without opening a
database transaction. A real import validates every selected file first, then
applies all writes in one transaction under a PostgreSQL advisory lock.
Deterministic UUID v5 identities and natural-key adoption make repeated and
serialized concurrent imports idempotent.

On a new deployment, apply the Prisma migrations before running `pnpm db:seed`.
The live search, programme detail and watchlist views intentionally hide records
until their source-backed summaries have been imported.
