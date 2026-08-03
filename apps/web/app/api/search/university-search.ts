import { database, Prisma } from "@athenvia/database";

import { UniversitySearchResultSchema } from "@athenvia/contracts";

import { searchQueryTokens } from "./tokens";

import type { UniversitySearchResult } from "@athenvia/contracts";

const UNIVERSITY_RESULT_LIMIT = 5;
const FUZZY_TOKEN_LENGTH = 4;

type RankedUniversity = {
  id: string;
  name: string;
  country_code: string;
  city: string | null;
  official_website: string | null;
  program_count: number;
  relevance: number;
};

/**
 * Every query token must match the university independently — as a word start
 * in the name or an alias, or (for tokens long enough to make trigram
 * similarity meaningful) as a close word via `<%`. Substring-anywhere and
 * whole-string trigram matching are deliberately absent: against the full ROR
 * registry they filled the suggestions with universities that merely shared a
 * common word or letter run with the query.
 */
function universityTokenFilter(token: string): Prisma.Sql {
  const wordStart = `\\m${token}`;
  const fuzzyName =
    token.length >= FUZZY_TOKEN_LENGTH
      ? Prisma.sql` OR ${token} <% public.immutable_unaccent(lower(m.name))`
      : Prisma.empty;
  const fuzzyAlias =
    token.length >= FUZZY_TOKEN_LENGTH
      ? Prisma.sql` OR ${token} <% public.immutable_unaccent(lower(ua.alias))`
      : Prisma.empty;
  return Prisma.sql`u.id IN (
    SELECT m.id
    FROM universities AS m
    WHERE public.immutable_unaccent(lower(m.name)) ~ ${wordStart}${fuzzyName}
    UNION
    SELECT ua.university_id
    FROM university_aliases AS ua
    WHERE public.immutable_unaccent(lower(ua.alias)) ~ ${wordStart}${fuzzyAlias}
  )`;
}

/**
 * Finds universities matching the search term by name or alias. Universities
 * appear in search even before any of their programs is tracked; the count
 * only includes programs that are visible in the catalogue, so the product
 * never advertises programs it would then refuse to show.
 */
export async function searchUniversities(query: string): Promise<UniversitySearchResult[]> {
  const tokens = searchQueryTokens(query);
  // A query with no latin tokens (e.g. a native-script name) falls back to
  // exact substring matching against names and aliases.
  const matchClause =
    tokens.length > 0
      ? Prisma.join(tokens.map(universityTokenFilter), " AND ")
      : Prisma.sql`(
          position(search_input.term IN public.immutable_unaccent(lower(u.name))) > 0
          OR EXISTS (
            SELECT 1
            FROM university_aliases AS matching_alias
            WHERE matching_alias.university_id = u.id
              AND position(
                search_input.term IN public.immutable_unaccent(lower(matching_alias.alias))
              ) > 0
          )
        )`;
  const rankedUniversities = await database.$queryRaw<RankedUniversity[]>(Prisma.sql`
    WITH search_input AS (
      SELECT public.immutable_unaccent(lower(${query})) AS term
    )
    SELECT
      u.id,
      u.name,
      u.country_code,
      u.city,
      u.official_website,
      (
        SELECT count(*)::int
        FROM programs AS p
        WHERE p.university_id = u.id
          AND p.status = 'ACTIVE'
          AND EXISTS (
            SELECT 1
            FROM intakes AS intake
            WHERE intake.program_id = p.id
          )
      ) AS program_count,
      GREATEST(
        word_similarity(search_input.term, public.immutable_unaccent(lower(u.name)))
          + CASE
              WHEN public.immutable_unaccent(lower(u.name)) = search_input.term THEN 2
              WHEN position(search_input.term IN public.immutable_unaccent(lower(u.name))) = 1
                THEN 0.5
              ELSE 0
            END,
        COALESCE(
          (
            SELECT MAX(
              word_similarity(search_input.term, public.immutable_unaccent(lower(ua.alias)))
                + CASE
                    WHEN public.immutable_unaccent(lower(ua.alias)) = search_input.term THEN 2
                    ELSE 0
                  END
            )
            FROM university_aliases AS ua
            WHERE ua.university_id = u.id
          ),
          0
        )
      )::double precision AS relevance
    FROM universities AS u
    CROSS JOIN search_input
    WHERE u.status = 'ACTIVE'
      AND ${matchClause}
    ORDER BY
      relevance DESC,
      program_count DESC,
      -- Among equal matches the shortest name is the most canonical entry:
      -- "Harvard University" before "Harvard Global Health Institute".
      length(u.normalized_name) ASC,
      u.normalized_name ASC,
      u.id ASC
    LIMIT ${UNIVERSITY_RESULT_LIMIT}
  `);

  return rankedUniversities.map((university) => ({
    id: university.id,
    name: university.name,
    countryCode: university.country_code,
    city: university.city,
    // A malformed stored URL must degrade to "no website", never break search.
    officialWebsite: UniversitySearchResultSchema.shape.officialWebsite.safeParse(
      university.official_website,
    ).success
      ? university.official_website
      : null,
    programCount: university.program_count,
  }));
}
