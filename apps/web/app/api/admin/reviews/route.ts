import { NextResponse } from "next/server";

import { listPendingAdminReviews } from "./service";
import { resolveAdminAccess } from "./security";

function json(body: unknown, status = 200) {
  return NextResponse.json(body, {
    headers: { "Cache-Control": "private, no-store" },
    status,
  });
}

export async function GET() {
  const access = await resolveAdminAccess();
  if (access.status === "UNAUTHENTICATED") {
    return json({ error: "Authentication required." }, 401);
  }
  if (access.status === "FORBIDDEN") {
    return json({ error: "Administrator access required." }, 403);
  }
  return json({ reviews: await listPendingAdminReviews() });
}
