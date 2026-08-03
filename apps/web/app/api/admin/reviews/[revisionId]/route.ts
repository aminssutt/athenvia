import { NextResponse } from "next/server";

import { logRequestError } from "@/lib/observability";

import {
  AdminReviewApplyError,
  AdminReviewConflictError,
  AdminReviewNotFoundError,
  decideAdminReview,
} from "../service";
import { isTrustedAdminWrite, resolveAdminAccess } from "../security";

type RouteContext = { params: Promise<{ revisionId: string }> };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

export async function POST(request: Request, context: RouteContext) {
  if (!isTrustedAdminWrite(request)) {
    return json({ error: "Invalid request origin." }, 403);
  }

  try {
    const access = await resolveAdminAccess();
    if (access.status === "UNAUTHENTICATED") {
      return json({ error: "Authentication required." }, 401);
    }
    if (access.status === "FORBIDDEN") {
      return json({ error: "Administrator access required." }, 403);
    }

    let decision: "APPROVE" | "REJECT";
    try {
      const body = (await request.json()) as { decision?: unknown };
      if (body.decision !== "APPROVE" && body.decision !== "REJECT") {
        throw new TypeError("Invalid decision.");
      }
      decision = body.decision;
    } catch {
      return json({ error: "Decision must be APPROVE or REJECT." }, 400);
    }

    const { revisionId } = await context.params;
    await decideAdminReview(revisionId, access.principal.id, decision);
    return json({ status: decision === "APPROVE" ? "APPROVED" : "REJECTED" });
  } catch (error) {
    if (error instanceof AdminReviewConflictError || error instanceof AdminReviewApplyError) {
      return json({ error: error.message }, 409);
    }
    if (error instanceof AdminReviewNotFoundError) {
      return json({ error: error.message }, 404);
    }
    logRequestError(request, {
      code: "ADMIN_REVIEW_DECISION_FAILED",
      error,
      route: "/api/admin/reviews/[revisionId]",
    });
    return json({ error: "Admin review updates are unavailable right now. Try again soon." }, 503);
  }
}
