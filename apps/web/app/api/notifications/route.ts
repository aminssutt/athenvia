import { logRequestError } from "@/lib/observability";

import { getAuthenticatedUser } from "../settings/authenticated-user";
import { privateJson } from "../settings/http";
import { loadNotificationHistory } from "./history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request = new Request("http://localhost/api/notifications"),
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return privateJson({ error: "Authentication required." }, { status: 401 });
    }

    return privateJson({
      items: await loadNotificationHistory(user.id),
    });
  } catch (error) {
    logRequestError(request, {
      code: "NOTIFICATION_HISTORY_LOOKUP_FAILED",
      error,
      route: "/api/notifications",
    });
    return privateJson(
      {
        error: "Notification history is not available right now. Try again soon.",
      },
      { status: 503 },
    );
  }
}
