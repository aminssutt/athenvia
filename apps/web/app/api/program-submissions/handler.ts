import { ActiveUniversityNotFoundError } from "@athenvia/database";

import { ProgramSubmissionRequestSchema } from "./schema";

import type { PendingProgramSubmission, PendingProgramSubmissionInput } from "@athenvia/database";
import type { ProgramSubmissionRateLimit } from "./rate-limit";

const MAXIMUM_REQUEST_BYTES = 8_192;

type ProgramSubmissionDependencies = {
  authenticatedUserId: () => Promise<string | null>;
  checkRateLimit: (request: Request, userId: string) => Promise<ProgramSubmissionRateLimit>;
  createSubmission: (input: PendingProgramSubmissionInput) => Promise<PendingProgramSubmission>;
  isTrustedOrigin: (request: Request) => boolean;
  rateLimitHeaders: (rateLimit: ProgramSubmissionRateLimit) => HeadersInit;
};

function errorResponse(
  code: string,
  message: string,
  status: number,
  headers: HeadersInit = {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Cookie",
  },
): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status, headers },
  );
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAXIMUM_REQUEST_BYTES) {
    throw new Error("REQUEST_TOO_LARGE");
  }

  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAXIMUM_REQUEST_BYTES) {
    throw new Error("REQUEST_TOO_LARGE");
  }

  return JSON.parse(body) as unknown;
}

export function createProgramSubmissionPostHandler(
  dependencies: ProgramSubmissionDependencies,
): (request: Request) => Promise<Response> {
  return async function POST(request: Request): Promise<Response> {
    if (!dependencies.isTrustedOrigin(request)) {
      return errorResponse(
        "UNTRUSTED_ORIGIN",
        "This request did not originate from Athenvia.",
        403,
      );
    }

    const userId = await dependencies.authenticatedUserId();
    if (!userId) {
      return errorResponse("UNAUTHORIZED", "Sign in before suggesting a missing program.", 401);
    }

    const rateLimit = await dependencies.checkRateLimit(request, userId);
    const headers = dependencies.rateLimitHeaders(rateLimit);
    if (!rateLimit.allowed) {
      return errorResponse(
        "RATE_LIMITED",
        "Too many program suggestions. Please wait before trying again.",
        429,
        {
          ...headers,
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      );
    }

    let input: unknown;
    try {
      input = await readBoundedJson(request);
    } catch {
      return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400, headers);
    }

    const parsedInput = ProgramSubmissionRequestSchema.safeParse(input);
    if (!parsedInput.success) {
      return errorResponse(
        "INVALID_REQUEST",
        "Check the program and university details.",
        400,
        headers,
      );
    }

    try {
      const submission = await dependencies.createSubmission({
        submittedByUserId: userId,
        universityId: parsedInput.data.universityId,
        universityName: parsedInput.data.universityName,
        name: parsedInput.data.programName,
        degreeType: parsedInput.data.degreeType,
        domain: parsedInput.data.domain,
        officialUrl: parsedInput.data.officialUrl,
      });

      return Response.json(
        {
          status: "pending_review",
          submissionId: submission.id,
        },
        {
          status: 201,
          headers,
        },
      );
    } catch (error) {
      if (error instanceof ActiveUniversityNotFoundError) {
        return errorResponse(
          "UNIVERSITY_NOT_FOUND",
          "Select an active university from Athenvia search.",
          404,
          headers,
        );
      }

      const requestId = crypto.randomUUID();
      console.error(`[program-submission:${requestId}] persistence failed`, error);
      return errorResponse(
        "SUBMISSION_UNAVAILABLE",
        "The program suggestion could not be saved. Try again soon.",
        503,
        headers,
      );
    }
  };
}
