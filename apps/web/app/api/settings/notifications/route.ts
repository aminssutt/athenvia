import { logRequestError } from "@/lib/observability";

import { getAuthenticatedUser } from "../authenticated-user";
import { forbiddenMutationResponse, isSameOriginMutation, privateJson } from "../http";
import { notificationSettingsSchema } from "../schemas";
import { loadNotificationSettings, saveNotificationSettings } from "../services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request = new Request("http://localhost/api/settings/notifications"),
): Promise<Response> {
  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return privateJson({ error: "Authentication required." }, { status: 401 });
    }

    const settings = await loadNotificationSettings(user.id);
    return privateJson(settings);
  } catch (error) {
    logRequestError(request, {
      code: "NOTIFICATION_SETTINGS_LOOKUP_FAILED",
      error,
      route: "/api/settings/notifications",
    });
    return privateJson(
      { error: "Notification settings are unavailable right now. Try again soon." },
      { status: 503 },
    );
  }
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return forbiddenMutationResponse();
  }

  try {
    const user = await getAuthenticatedUser();

    if (!user) {
      return privateJson({ error: "Authentication required." }, { status: 401 });
    }

    let input: unknown;

    try {
      input = await request.json();
    } catch {
      return privateJson({ error: "A valid JSON body is required." }, { status: 400 });
    }

    const parsed = notificationSettingsSchema.safeParse(input);

    if (!parsed.success) {
      return privateJson({ error: "Notification settings are invalid." }, { status: 400 });
    }

    await saveNotificationSettings(user.id, parsed.data);
    return privateJson(await loadNotificationSettings(user.id));
  } catch (error) {
    logRequestError(request, {
      code: "NOTIFICATION_SETTINGS_UPDATE_FAILED",
      error,
      route: "/api/settings/notifications",
    });
    return privateJson(
      { error: "Notification settings are unavailable right now. Try again soon." },
      { status: 503 },
    );
  }
}
