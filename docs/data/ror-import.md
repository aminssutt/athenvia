# ROR university registry import

The Research Organization Registry ([ror.org](https://ror.org)) is a CC0 registry of
research organizations. Athenvia imports its active `education` organizations as the
backbone of the university catalogue: name, aliases and acronyms, country, city, official
domain and website. ROR is a registry, not a university's own site, so every imported
university carries a non-official `REGISTRY` source pointing at its ROR record; ROR data
is never evidence for application dates.

## Running the import

From the repository root:

```bash
# Download the latest dump from Zenodo, validate the mapping without writing
pnpm db:import:ror -- --dry-run

# Full import (about 25k universities)
pnpm db:import:ror

# Re-use a previously downloaded dump, restrict scope while testing
pnpm db:import:ror -- data/ror-cache/v2.10-2026-07-20-ror-data.json --countries FR,DE --limit 100
```

The dump archive is cached in `data/ror-cache/` (gitignored). Parsing the dump needs
roughly 2 GB of memory.

## Guarantees

- **Idempotent.** Deterministic UUIDs derived from the ROR identifier plus
  `createMany … skipDuplicates` mean a re-run inserts nothing and reports zero created
  rows. Concurrent runs serialize on a PostgreSQL advisory lock.
- **Curated data wins.** An existing university matched on the
  `(normalizedName, countryCode)` natural key is adopted, never rewritten: only fields
  that are currently `null` (city, official domain, official website) are filled in.
- **Scope.** Only `active` records typed `education` with a display name and an ISO
  country are imported. Registry records that collapse onto an already-imported natural
  key are skipped and counted.
- **Visibility.** Imported universities are `ACTIVE` catalogue entries. Programs remain
  invisible in search until they carry a source-backed summary, exactly as before; the
  import only widens the university directory.
