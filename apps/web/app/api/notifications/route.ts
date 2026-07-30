import { getAuthenticatedUser } from "../settings/authenticated-user";
import { privateJson } from "../settings/http";
import { loadNotificationHistory } from "./history";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request?: Request): Promise<Response> {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return privateJson({ error: "Authentication required." }, { status: 401 });
    }

    return privateJson({
      items: await loadNotificationHistory(user.id),
    });
  } catch {
    const requestId = crypto.randomUUID();
    console.error(`[notification-history:${requestId}] private history lookup failed`);
    return privateJson(
      {
        error: "Notification history is not available right now. Try again soon.",
      },
      { status: 503 },
    );
  }
}
