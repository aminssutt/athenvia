import {
  SearchErrorResponseSchema,
  SearchRequestSchema,
  SearchResponseSchema,
} from "@athenvia/contracts";

import type { SearchErrorResponse } from "@athenvia/contracts";

import { logRequestError } from "@/lib/observability";

import { searchCatalogue } from "./catalogue-search";
import { decodeSearchCursor } from "./cursor";
import { searchUniversities } from "./university-search";
import { checkSearchRateLimit, searchRateLimitHeaders } from "./rate-limit";

export const dynamic = "force-dynamic";

function errorResponse(body: SearchErrorResponse, status: number, headers: HeadersInit): Response {
  return Response.json(SearchErrorResponseSchema.parse(body), {
    status,
    headers,
  });
}

export async function GET(request: Request): Promise<Response> {
  const rateLimit = await checkSearchRateLimit(request);
  const headers = searchRateLimitHeaders(rateLimit);

  if (!rateLimit.allowed) {
    return errorResponse(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many searches. Please wait a moment and try again.",
          retryAfterSeconds: rateLimit.retryAfterSeconds,
        },
      },
      429,
      {
        ...headers,
        "Retry-After": String(rateLimit.retryAfterSeconds),
      },
    );
  }

  const url = new URL(request.url);
  const parsedInput = SearchRequestSchema.safeParse({
    query: url.searchParams.get("query") ?? undefined,
    domain: url.searchParams.get("domain") ?? undefined,
    cursor: url.searchParams.get("cursor") ?? undefined,
  });

  if (!parsedInput.success) {
    return errorResponse(
      {
        error: {
          code: "INVALID_REQUEST",
          message: "Check the search terms and try again.",
          issues: parsedInput.error.issues.map((issue) => ({
            path: issue.path.map((segment) =>
              typeof segment === "symbol" ? (segment.description ?? String(segment)) : segment,
            ),
            message: issue.message,
          })),
        },
      },
      400,
      headers,
    );
  }

  let offset: number;
  try {
    offset = decodeSearchCursor(parsedInput.data.cursor).offset;
  } catch {
    return errorResponse(
      {
        error: {
          code: "INVALID_CURSOR",
          message: "This results page is no longer available. Start the search again.",
        },
      },
      400,
      headers,
    );
  }

  try {
    // Universities belong to the first results page only; later pages continue
    // the programme listing without repeating the same university matches.
    const [results, universities] = await Promise.all([
      searchCatalogue(parsedInput.data, offset),
      offset === 0 ? searchUniversities(parsedInput.data.query) : Promise.resolve([]),
    ]);
    return Response.json(SearchResponseSchema.parse({ ...results, universities }), { headers });
  } catch (error) {
    logRequestError(request, { code: "CATALOGUE_QUERY_FAILED", error, route: "/api/search" });

    return errorResponse(
      {
        error: {
          code: "SEARCH_UNAVAILABLE",
          message: "Search is unavailable right now. Please try again soon.",
          retryAfterSeconds: 5,
        },
      },
      503,
      {
        ...headers,
        "Retry-After": "5",
      },
    );
  }
}
