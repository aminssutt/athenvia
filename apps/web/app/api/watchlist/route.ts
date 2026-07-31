import { followProgram, WatchlistTargetNotFoundError } from "@athenvia/database";
import { z } from "zod";

import { logRequestError } from "@/lib/observability";

import {
  authenticatedUserId,
  isTrustedMutationOrigin,
  mutationResponseHeaders,
} from "./request-security";

export const dynamic = "force-dynamic";

const FollowProgramRequestSchema = z
  .object({
    programId: z.string().uuid(),
    intakeId: z.string().uuid(),
  })
  .strict();

function errorResponse(code: string, message: string, status: number): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    {
      status,
      headers: mutationResponseHeaders(),
    },
  );
}

export async function POST(request: Request): Promise<Response> {
  if (!isTrustedMutationOrigin(request)) {
    return errorResponse("UNTRUSTED_ORIGIN", "This request did not originate from Athenvia.", 403);
  }

  const userId = await authenticatedUserId();
  if (!userId) {
    return errorResponse("UNAUTHORIZED", "Sign in before following a program.", 401);
  }

  let requestBody: unknown;
  try {
    requestBody = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400);
  }

  const parsedRequest = FollowProgramRequestSchema.safeParse(requestBody);
  if (!parsedRequest.success) {
    return errorResponse("INVALID_REQUEST", "Provide valid program and intake identifiers.", 400);
  }

  try {
    const result = await followProgram({
      userId,
      ...parsedRequest.data,
    });

    return Response.json(result, {
      status: result.created ? 201 : 200,
      headers: mutationResponseHeaders(),
    });
  } catch (error) {
    if (error instanceof WatchlistTargetNotFoundError) {
      return errorResponse(
        "PROGRAM_INTAKE_NOT_FOUND",
        "This active program intake is not available.",
        404,
      );
    }

    logRequestError(request, { code: "WATCHLIST_FOLLOW_FAILED", error, route: "/api/watchlist" });
    return errorResponse(
      "WATCHLIST_UNAVAILABLE",
      "The program could not be followed right now. Try again soon.",
      503,
    );
  }
}
