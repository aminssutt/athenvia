-- PostgreSQL extensions used by catalogue search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- `unaccent` is STABLE because its dictionary could change. Athenvia always
-- resolves the same public dictionary, so this wrapper can safely be used by
-- expression indexes.
CREATE OR REPLACE FUNCTION public.immutable_unaccent(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
STRICT
AS $$
  SELECT public.unaccent('public.unaccent'::regdictionary, input)
$$;

CREATE INDEX universities_name_search_idx
ON universities
USING GIN ((public.immutable_unaccent(lower(name))) gin_trgm_ops);

CREATE INDEX universities_normalized_name_search_idx
ON universities
USING GIN (normalized_name gin_trgm_ops);

CREATE INDEX university_aliases_alias_search_idx
ON university_aliases
USING GIN ((public.immutable_unaccent(lower(alias))) gin_trgm_ops);

CREATE INDEX university_aliases_normalized_alias_search_idx
ON university_aliases
USING GIN (normalized_alias gin_trgm_ops);

CREATE INDEX programs_name_search_idx
ON programs
USING GIN ((public.immutable_unaccent(lower(name))) gin_trgm_ops);

CREATE INDEX programs_normalized_name_search_idx
ON programs
USING GIN (normalized_name gin_trgm_ops);

