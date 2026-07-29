# Catalogue search indexes

Athenvia uses PostgreSQL `pg_trgm` and `unaccent` for tolerant catalogue
search. The migration adds GIN expression indexes for:

- university display and normalized names;
- university display and normalized aliases;
- program display and normalized names.

Search queries must normalize both the stored value and the user query with
`public.immutable_unaccent(lower(...))`.

Results must use an explicit deterministic order:

```sql
ORDER BY
  similarity(indexed_value, normalized_query) DESC,
  normalized_name ASC,
  id ASC
```

The final `id` tie breaker is mandatory. PostgreSQL index scan order is not a
stable ranking.

## Integration test

After applying migrations to the local Docker database:

```powershell
Get-Content -Raw packages/database/tests/search-indexes.sql |
  docker exec -i athe-postgres-1 psql -U athenvia -d athenvia
```

The test runs inside a transaction and rolls back all fixtures.

