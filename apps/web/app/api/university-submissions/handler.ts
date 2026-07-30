import type { PendingUniversitySubmissionInput } from "@athenvia/database";

import { resolveCountryCode } from "./country";
import type { UniversitySubmissionRateLimit } from "./rate-limit";
import { universitySubmissionRateLimitHeaders } from "./rate-limit";
import { UnsafeOfficialWebsiteError } from "./safe-url";
import { UniversitySubmissionRequestSchema } from "./schema";

const MAXIMUM_BODY_BYTES = 8_192;
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

type UniversitySubmissionDependencies = {
  getAuthenticatedUserId: () => Promise<string | null>;
  checkRateLimit: (request: Request, userId: string) => Promise<UniversitySubmissionRateLimit>;
  validateWebsite: (website: string) => Promise<string>;
  createSubmission: (
    input: PendingUniversitySubmissionInput,
  ) => Promise<{ id: string; status: "PENDING" }>;
};

type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "CROSS_SITE_REQUEST"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_REQUEST"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMITED"
  | "SUBMISSION_UNAVAILABLE"
  | "UNSAFE_WEBSITE";

function errorResponse(
  code: ApiErrorCode,
  message: string,
  status: number,
  headers: HeadersInit = NO_STORE_HEADERS,
  issues?: Array<{ path: Array<string | number>; message: string }>,
) {
  return Response.json(
    {
      error: {
        code,
        message,
        ...(issues ? { issues } : {}),
      },
    },
    { status, headers },
  );
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function isCrossSiteRequest(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return true;
  }

  const origin = request.headers.get("origin");
  if (!origin) {
    return true;
  }

  const configuredOrigin = process.env.NEXTAUTH_URL
    ? normalizedOrigin(process.env.NEXTAUTH_URL)
    : null;
  const trustedOrigin = configuredOrigin ?? normalizedOrigin(request.url);
  return !trustedOrigin || normalizedOrigin(origin) !== trustedOrigin;
}

async function readJsonBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAXIMUM_BODY_BYTES) {
    throw new RangeError("PAYLOAD_TOO_LARGE");
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAXIMUM_BODY_BYTES) {
    throw new RangeError("PAYLOAD_TOO_LARGE");
  }

  return JSON.parse(body) as unknown;
}

export function createUniversitySubmissionPostHandler(
  dependencies: UniversitySubmissionDependencies,
) {
  return async function POST(request: Request): Promise<Response> {
    if (isCrossSiteRequest(request)) {
      return errorResponse("CROSS_SITE_REQUEST", "This submission must come from Athenvia.", 403);
    }

    let userId: string | null;
    try {
      userId = await dependencies.getAuthenticatedUserId();
    } catch {
      return errorResponse(
        "SUBMISSION_UNAVAILABLE",
        "University submissions are unavailable right now. Please try again soon.",
        503,
      );
    }

    if (!userId) {
      return errorResponse("AUTH_REQUIRED", "Sign in before submitting a university.", 401);
    }

    const rateLimit = await dependencies.checkRateLimit(request, userId);
    const rateLimitHeaders = universitySubmissionRateLimitHeaders(rateLimit);

    if (!rateLimit.allowed) {
      return errorResponse(
        "RATE_LIMITED",
        "Too many university submissions. Please wait before trying again.",
        429,
        {
          ...rateLimitHeaders,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      );
    }

    if (
      !request.headers.get("content-type")?.toLocaleLowerCase("en").startsWith("application/json")
    ) {
      return errorResponse(
        "INVALID_CONTENT_TYPE",
        "Send university submissions as JSON.",
        415,
        rateLimitHeaders,
      );
    }

    let input: unknown;
    try {
      input = await readJsonBody(request);
    } catch (error) {
      if (error instanceof RangeError) {
        return errorResponse(
          "PAYLOAD_TOO_LARGE",
          "The university submission is too large.",
          413,
          rateLimitHeaders,
        );
      }
      return errorResponse(
        "INVALID_REQUEST",
        "The university submission is not valid JSON.",
        400,
        rateLimitHeaders,
      );
    }

    const parsedInput = UniversitySubmissionRequestSchema.safeParse(input);
    if (!parsedInput.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "Check the university details and try again.",
        400,
        rateLimitHeaders,
        parsedInput.error.issues.map((issue) => ({
          path: issue.path.map((segment) =>
            typeof segment === "symbol" ? (segment.description ?? String(segment)) : segment,
          ),
          message: issue.message,
        })),
      );
    }

    const countryCode = resolveCountryCode(parsedInput.data.country);
    if (!countryCode) {
      return errorResponse(
        "INVALID_REQUEST",
        "Enter a recognized country name.",
        400,
        rateLimitHeaders,
        [{ path: ["country"], message: "Enter a recognized country name." }],
      );
    }

    let officialWebsite: string | null = null;
    if (parsedInput.data.officialWebsite) {
      try {
        officialWebsite = await dependencies.validateWebsite(parsedInput.data.officialWebsite);
      } catch (error) {
        const message =
          error instanceof UnsafeOfficialWebsiteError
            ? error.message
            : "The official website could not be verified safely.";
        return errorResponse("UNSAFE_WEBSITE", message, 400, rateLimitHeaders, [
          { path: ["officialWebsite"], message },
        ]);
      }
    }

    try {
      const submission = await dependencies.createSubmission({
        submittedByUserId: userId,
        name: parsedInput.data.universityName,
        countryCode,
        officialWebsite,
      });

      return Response.json(
        {
          status: "pending_review",
          submissionId: submission.id,
        },
        {
          status: 201,
          headers: rateLimitHeaders,
        },
      );
    } catch {
      return errorResponse(
        "SUBMISSION_UNAVAILABLE",
        "University submissions are unavailable right now. Please try again soon.",
        503,
        rateLimitHeaders,
      );
    }
  };
}
