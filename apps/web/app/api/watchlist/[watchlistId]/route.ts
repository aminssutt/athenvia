import { unfollowProgram } from "@athenvia/database";
import { z } from "zod";

import {
  authenticatedUserId,
  isTrustedMutationOrigin,
  mutationResponseHeaders,
} from "../request-security";

export const dynamic = "force-dynamic";

const WatchlistIdentifierSchema = z.string().uuid();

type RouteContext = {
  params: Promise<{
    watchlistId: string;
  }>;
};

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

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  if (!isTrustedMutationOrigin(request)) {
    return errorResponse("UNTRUSTED_ORIGIN", "This request did not originate from Athenvia.", 403);
  }

  const userId = await authenticatedUserId();
  if (!userId) {
    return errorResponse("UNAUTHORIZED", "Sign in before updating your watchlist.", 401);
  }

  const { watchlistId } = await context.params;
  if (!WatchlistIdentifierSchema.safeParse(watchlistId).success) {
    return errorResponse("INVALID_REQUEST", "Provide a valid watchlist identifier.", 400);
  }

  try {
    await unfollowProgram(userId, watchlistId);
    return new Response(null, {
      status: 204,
      headers: mutationResponseHeaders(),
    });
  } catch (error) {
    const requestId = crypto.randomUUID();
    console.error(`[watchlist:${requestId}] unfollow failed`, error);
    return errorResponse(
      "WATCHLIST_UNAVAILABLE",
      "The watchlist could not be updated right now. Try again soon.",
      503,
    );
  }
}
