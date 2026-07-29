\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    RAISE EXCEPTION 'pg_trgm extension is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'unaccent') THEN
    RAISE EXCEPTION 'unaccent extension is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'universities_name_search_idx',
        'universities_normalized_name_search_idx',
        'university_aliases_alias_search_idx',
        'university_aliases_normalized_alias_search_idx',
        'programs_name_search_idx',
        'programs_normalized_name_search_idx'
      )
  ) <> 6 THEN
    RAISE EXCEPTION 'one or more catalogue search indexes are missing';
  END IF;
END
$$;

INSERT INTO universities (
  id,
  name,
  normalized_name,
  country_code,
  official_domain,
  official_website,
  status,
  created_at,
  updated_at
)
VALUES
  (
    '10000000-0000-0000-0000-000000000001',
    'École Polytechnique',
    'ecole polytechnique',
    'FR',
    'polytechnique.edu',
    'https://www.polytechnique.edu/',
    'ACTIVE',
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000002',
    'National University of Search Testing',
    'national university of search testing',
    'ZZ',
    'search-testing.example',
    'https://search-testing.example/',
    'ACTIVE',
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000003',
    'Test University',
    'test university',
    'FR',
    'test-university.fr',
    'https://test-university.fr/',
    'ACTIVE',
    now(),
    now()
  ),
  (
    '10000000-0000-0000-0000-000000000004',
    'Test University',
    'test university',
    'GB',
    'test-university.ac.uk',
    'https://test-university.ac.uk/',
    'ACTIVE',
    now(),
    now()
  );

INSERT INTO university_aliases (
  id,
  university_id,
  alias,
  normalized_alias
)
VALUES
  (
    '20000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000002',
    'NUSTEST',
    'nustest'
  );

INSERT INTO programs (
  id,
  university_id,
  name,
  normalized_name,
  degree_type,
  status,
  created_at,
  updated_at
)
VALUES
  (
    '30000000-0000-0000-0000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'Master in Artificial Intelligence',
    'master in artificial intelligence',
    'MASTER',
    'ACTIVE',
    now(),
    now()
  );

DO $$
DECLARE
  accent_match uuid;
  alias_match uuid;
  typo_match uuid;
  program_match uuid;
  deterministic_match uuid;
BEGIN
  SELECT id
  INTO accent_match
  FROM universities
  WHERE public.immutable_unaccent(lower(name))
    % public.immutable_unaccent(lower('Ecole Polytechnique'))
  ORDER BY
    similarity(
      public.immutable_unaccent(lower(name)),
      public.immutable_unaccent(lower('Ecole Polytechnique'))
    ) DESC,
    normalized_name ASC,
    id ASC
  LIMIT 1;

  IF accent_match <> '10000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'accent-insensitive university search failed';
  END IF;

  SELECT university_id
  INTO alias_match
  FROM university_aliases
  WHERE public.immutable_unaccent(lower(alias))
    % public.immutable_unaccent(lower('NUSTEST'))
  ORDER BY
    similarity(
      public.immutable_unaccent(lower(alias)),
      public.immutable_unaccent(lower('NUSTEST'))
    ) DESC,
    normalized_alias ASC,
    university_id ASC
  LIMIT 1;

  IF alias_match <> '10000000-0000-0000-0000-000000000002'::uuid THEN
    RAISE EXCEPTION 'university alias search failed';
  END IF;

  SELECT id
  INTO typo_match
  FROM universities
  WHERE public.immutable_unaccent(lower(name))
    % public.immutable_unaccent(lower('National Universty Search Testng'))
  ORDER BY
    similarity(
      public.immutable_unaccent(lower(name)),
      public.immutable_unaccent(lower('National Universty Search Testng'))
    ) DESC,
    normalized_name ASC,
    id ASC
  LIMIT 1;

  IF typo_match <> '10000000-0000-0000-0000-000000000002'::uuid THEN
    RAISE EXCEPTION 'trigram typo tolerance failed';
  END IF;

  SELECT id
  INTO program_match
  FROM programs
  WHERE public.immutable_unaccent(lower(name))
    % public.immutable_unaccent(lower('Master Artificial Inteligence'))
  ORDER BY
    similarity(
      public.immutable_unaccent(lower(name)),
      public.immutable_unaccent(lower('Master Artificial Inteligence'))
    ) DESC,
    normalized_name ASC,
    id ASC
  LIMIT 1;

  IF program_match <> '30000000-0000-0000-0000-000000000001'::uuid THEN
    RAISE EXCEPTION 'program trigram search failed';
  END IF;

  SELECT id
  INTO deterministic_match
  FROM universities
  WHERE normalized_name = 'test university'
  ORDER BY normalized_name ASC, id ASC
  LIMIT 1;

  IF deterministic_match <> '10000000-0000-0000-0000-000000000003'::uuid THEN
    RAISE EXCEPTION 'deterministic tie breaking failed';
  END IF;
END
$$;

ROLLBACK;
