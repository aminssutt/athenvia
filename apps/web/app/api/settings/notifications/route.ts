import { getAuthenticatedUser } from "../authenticated-user";
import { forbiddenMutationResponse, isSameOriginMutation, privateJson } from "../http";
import { notificationSettingsSchema } from "../schemas";
import { loadNotificationSettings, saveNotificationSettings } from "../services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const user = await getAuthenticatedUser();

  if (!user) {
    return privateJson({ error: "Authentication required." }, { status: 401 });
  }

  const settings = await loadNotificationSettings(user.id);
  return privateJson(settings);
}

export async function PATCH(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return forbiddenMutationResponse();
  }

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
}
