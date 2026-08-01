import { database, Prisma } from "@athenvia/database";

import { UniversitySearchResultSchema } from "@athenvia/contracts";

import type { UniversitySearchResult } from "@athenvia/contracts";

const UNIVERSITY_RESULT_LIMIT = 5;

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
 * Finds universities matching the search term by name or alias. Universities
 * appear in search even before any of their programs is tracked; the count
 * only includes programs that are visible in the catalogue, so the product
 * never advertises programs it would then refuse to show.
 */
export async function searchUniversities(query: string): Promise<UniversitySearchResult[]> {
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
        similarity(public.immutable_unaccent(lower(u.name)), search_input.term)
          + CASE
              WHEN public.immutable_unaccent(lower(u.name)) = search_input.term THEN 2
              WHEN position(search_input.term IN public.immutable_unaccent(lower(u.name))) = 1
                THEN 0.5
              ELSE 0
            END,
        COALESCE(
          (
            SELECT MAX(
              similarity(public.immutable_unaccent(lower(ua.alias)), search_input.term)
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
      AND (
        public.immutable_unaccent(lower(u.name)) % search_input.term
        OR position(search_input.term IN public.immutable_unaccent(lower(u.name))) > 0
        OR EXISTS (
          SELECT 1
          FROM university_aliases AS matching_alias
          WHERE matching_alias.university_id = u.id
            AND (
              public.immutable_unaccent(lower(matching_alias.alias)) % search_input.term
              OR position(
                search_input.term IN public.immutable_unaccent(lower(matching_alias.alias))
              ) > 0
            )
        )
      )
    ORDER BY relevance DESC, program_count DESC, u.normalized_name ASC, u.id ASC
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
