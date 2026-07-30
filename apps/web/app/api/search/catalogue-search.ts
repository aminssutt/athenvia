import { database, Prisma } from "@athenvia/database";

import type { ProgramSummary, SearchRequest, SearchResponse } from "@athenvia/contracts";

import { formatIntakeLabel, toPublicApplicationWindow } from "../../../lib/catalogue-presentation";

import { encodeSearchCursor, MAXIMUM_SEARCH_OFFSET } from "./cursor";

const SEARCH_PAGE_SIZE = 20;

type RankedProgram = {
  id: string;
  relevance: number;
};

export async function searchCatalogue(
  input: SearchRequest,
  offset: number,
): Promise<SearchResponse> {
  const domainFilter = input.domain?.toLocaleLowerCase("en") ?? null;
  const rankedPrograms = await database.$queryRaw<RankedProgram[]>(Prisma.sql`
    WITH search_input AS (
      SELECT
        public.immutable_unaccent(lower(${input.query})) AS term,
        CASE
          WHEN CAST(${domainFilter} AS text) IS NULL THEN NULL
          ELSE public.immutable_unaccent(lower(CAST(${domainFilter} AS text)))
        END AS domain
    )
    SELECT
      p.id,
      GREATEST(
        similarity(public.immutable_unaccent(lower(p.name)), search_input.term)
          + CASE
              WHEN public.immutable_unaccent(lower(p.name)) = search_input.term THEN 2
              WHEN position(search_input.term IN public.immutable_unaccent(lower(p.name))) = 1
                THEN 0.5
              ELSE 0
            END,
        similarity(public.immutable_unaccent(lower(u.name)), search_input.term),
        COALESCE(
          (
            SELECT MAX(similarity(
              public.immutable_unaccent(lower(ua.alias)),
              search_input.term
            ))
            FROM university_aliases AS ua
            WHERE ua.university_id = u.id
          ),
          0
        ),
        COALESCE(
          (
            SELECT MAX(similarity(
              public.immutable_unaccent(lower(d.name)),
              search_input.term
            ))
            FROM program_domains AS pd
            JOIN domains AS d ON d.id = pd.domain_id
            WHERE pd.program_id = p.id
          ),
          0
        )
      )::double precision AS relevance
    FROM programs AS p
    JOIN universities AS u ON u.id = p.university_id
    CROSS JOIN search_input
    WHERE p.status = 'ACTIVE'
      AND u.status = 'ACTIVE'
      AND EXISTS (
        SELECT 1
        FROM intakes AS intake
        WHERE intake.program_id = p.id
      )
      AND EXISTS (
        SELECT 1
        FROM program_summaries AS summary
        JOIN sources AS summary_source ON summary_source.id = summary.source_id
        WHERE summary.program_id = p.id
          AND summary_source.program_id = p.id
          AND summary_source.is_official = TRUE
      )
      AND (
        search_input.domain IS NULL
        OR EXISTS (
          SELECT 1
          FROM program_domains AS filtered_pd
          JOIN domains AS filtered_domain ON filtered_domain.id = filtered_pd.domain_id
          WHERE filtered_pd.program_id = p.id
            AND (
              public.immutable_unaccent(lower(filtered_domain.slug)) = search_input.domain
              OR public.immutable_unaccent(lower(filtered_domain.name)) = search_input.domain
            )
        )
      )
      AND (
        public.immutable_unaccent(lower(p.name)) % search_input.term
        OR position(search_input.term IN public.immutable_unaccent(lower(p.name))) > 0
        OR public.immutable_unaccent(lower(u.name)) % search_input.term
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
        OR EXISTS (
          SELECT 1
          FROM program_domains AS matching_pd
          JOIN domains AS matching_domain ON matching_domain.id = matching_pd.domain_id
          WHERE matching_pd.program_id = p.id
            AND (
              public.immutable_unaccent(lower(matching_domain.name)) % search_input.term
              OR position(
                search_input.term IN public.immutable_unaccent(lower(matching_domain.name))
              ) > 0
              OR public.immutable_unaccent(lower(matching_domain.slug)) % search_input.term
            )
        )
      )
    ORDER BY relevance DESC, p.normalized_name ASC, p.id ASC
    LIMIT ${SEARCH_PAGE_SIZE + 1}
    OFFSET ${offset}
  `);

  const pageMatches = rankedPrograms.slice(0, SEARCH_PAGE_SIZE);
  const orderedIds = pageMatches.map(({ id }) => id);
  const records = await database.program.findMany({
    where: { id: { in: orderedIds } },
    include: {
      domains: {
        include: { domain: true },
        orderBy: { domain: { name: "asc" } },
      },
      intakes: {
        orderBy: [{ year: "asc" }, { month: "asc" }],
        take: 1,
        include: {
          applicationWindows: {
            orderBy: [{ closesAt: "asc" }, { opensAt: "asc" }],
            take: 1,
            include: {
              source: {
                select: {
                  isOfficial: true,
                  programId: true,
                  url: true,
                },
              },
            },
          },
        },
      },
      university: true,
    },
  });
  const recordsById = new Map(records.map((program) => [program.id, program]));

  const programs = orderedIds.flatMap((id): ProgramSummary[] => {
    const program = recordsById.get(id);
    const intake = program?.intakes[0];
    if (!program || !intake) {
      return [];
    }

    const applicationWindow = intake.applicationWindows[0];
    return [
      {
        id: program.id,
        university: {
          id: program.university.id,
          name: program.university.name,
          countryCode: program.university.countryCode,
          city: program.university.city,
          logoUrl: null,
        },
        name: program.name,
        degreeType: program.degreeType,
        domains: program.domains.map(({ domain }) => domain.name),
        location: program.campus ?? program.university.city,
        durationMonths: program.durationMonths,
        intakeLabel: formatIntakeLabel(intake.year, intake.month),
        nextWindow: toPublicApplicationWindow(applicationWindow, program.id),
      },
    ];
  });

  const nextOffset = offset + SEARCH_PAGE_SIZE;
  const hasNextPage =
    rankedPrograms.length > SEARCH_PAGE_SIZE && nextOffset <= MAXIMUM_SEARCH_OFFSET;

  return {
    programs,
    nextCursor: hasNextPage ? encodeSearchCursor({ offset: nextOffset }) : null,
  };
}
