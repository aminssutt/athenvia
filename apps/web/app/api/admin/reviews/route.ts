import { NextResponse } from "next/server";

import { logRequestError } from "@/lib/observability";

import { listPendingAdminReviews } from "./service";
import { resolveAdminAccess } from "./security";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

export async function GET(request = new Request("http://localhost/api/admin/reviews")) {
  try {
    const access = await resolveAdminAccess();
    if (access.status === "UNAUTHENTICATED") {
      return json({ error: "Authentication required." }, 401);
    }
    if (access.status === "FORBIDDEN") {
      return json({ error: "Administrator access required." }, 403);
    }
    return json({ reviews: await listPendingAdminReviews() });
  } catch (error) {
    logRequestError(request, {
      code: "ADMIN_REVIEWS_LOOKUP_FAILED",
      error,
      route: "/api/admin/reviews",
    });
    return json({ error: "Admin reviews are unavailable right now. Try again soon." }, 503);
  }
}
