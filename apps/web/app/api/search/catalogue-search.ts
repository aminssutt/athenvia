import { database, Prisma } from "@athenvia/database";

import type { ProgramSummary, SearchRequest, SearchResponse } from "@athenvia/contracts";

import { formatIntakeLabel, toPublicApplicationWindow } from "../../../lib/catalogue-presentation";

import { encodeSearchCursor, MAXIMUM_SEARCH_OFFSET } from "./cursor";
import { searchQueryTokens } from "./tokens";

const SEARCH_PAGE_SIZE = 20;
const FUZZY_TOKEN_LENGTH = 4;

type RankedProgram = {
  id: string;
  relevance: number;
};

/**
 * Every query token must match the programme independently — as a word start
 * (or, for longer tokens, a close word via `<%`) in the programme name, the
 * university name, a university alias, or a domain. AND-ing tokens keeps
 * "informatique lyon" from returning every informatique programme in the
 * country; word-start matching keeps a query from dredging up rows that only
 * share a letter run or a generic word with it.
 */
function programTokenFilter(token: string): Prisma.Sql {
  const wordStart = `\\m${token}`;
  const fuzzy = (expression: Prisma.Sql) =>
    token.length >= FUZZY_TOKEN_LENGTH ? Prisma.sql` OR ${token} <% ${expression}` : Prisma.empty;
  return Prisma.sql`p.id IN (
    SELECT m.id
    FROM programs AS m
    WHERE public.immutable_unaccent(lower(m.name)) ~ ${wordStart}${fuzzy(
      Prisma.sql`public.immutable_unaccent(lower(m.name))`,
    )}
    UNION
    SELECT member.id
    FROM programs AS member
    WHERE member.university_id IN (
      SELECT mu.id
      FROM universities AS mu
      WHERE public.immutable_unaccent(lower(mu.name)) ~ ${wordStart}${fuzzy(
        Prisma.sql`public.immutable_unaccent(lower(mu.name))`,
      )}
      UNION
      SELECT ua.university_id
      FROM university_aliases AS ua
      WHERE public.immutable_unaccent(lower(ua.alias)) ~ ${wordStart}${fuzzy(
        Prisma.sql`public.immutable_unaccent(lower(ua.alias))`,
      )}
    )
    UNION
    SELECT pd.program_id
    FROM program_domains AS pd
    JOIN domains AS d ON d.id = pd.domain_id
    WHERE public.immutable_unaccent(lower(d.name)) ~ ${wordStart}${fuzzy(
      Prisma.sql`public.immutable_unaccent(lower(d.name))`,
    )}
      OR public.immutable_unaccent(lower(d.slug)) ~ ${wordStart}
  )`;
}

const SUBSTRING_FALLBACK_CLAUSE = Prisma.sql`(
  position(search_input.term IN public.immutable_unaccent(lower(p.name))) > 0
  OR position(search_input.term IN public.immutable_unaccent(lower(u.name))) > 0
  OR EXISTS (
    SELECT 1
    FROM university_aliases AS matching_alias
    WHERE matching_alias.university_id = u.id
      AND position(
        search_input.term IN public.immutable_unaccent(lower(matching_alias.alias))
      ) > 0
  )
  OR EXISTS (
    SELECT 1
    FROM program_domains AS matching_pd
    JOIN domains AS matching_domain ON matching_domain.id = matching_pd.domain_id
    WHERE matching_pd.program_id = p.id
      AND position(
        search_input.term IN public.immutable_unaccent(lower(matching_domain.name))
      ) > 0
  )
)`;

export async function searchCatalogue(
  input: SearchRequest,
  offset: number,
): Promise<Omit<SearchResponse, "universities">> {
  const domainFilter = input.domain?.toLocaleLowerCase("en") ?? null;
  const tokens = searchQueryTokens(input.query);
  // A query with no latin tokens (e.g. a native-script name) falls back to
  // exact substring matching against every searchable field.
  const matchClause =
    tokens.length > 0
      ? Prisma.join(tokens.map(programTokenFilter), " AND ")
      : SUBSTRING_FALLBACK_CLAUSE;
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
        word_similarity(search_input.term, public.immutable_unaccent(lower(p.name)))
          + CASE
              WHEN public.immutable_unaccent(lower(p.name)) = search_input.term THEN 2
              WHEN position(search_input.term IN public.immutable_unaccent(lower(p.name))) = 1
                THEN 0.5
              ELSE 0
            END,
        word_similarity(search_input.term, public.immutable_unaccent(lower(u.name))),
        COALESCE(
          (
            SELECT MAX(word_similarity(
              search_input.term,
              public.immutable_unaccent(lower(ua.alias))
            ))
            FROM university_aliases AS ua
            WHERE ua.university_id = u.id
          ),
          0
        ),
        COALESCE(
          (
            SELECT MAX(word_similarity(
              search_input.term,
              public.immutable_unaccent(lower(d.name))
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
      AND ${matchClause}
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
