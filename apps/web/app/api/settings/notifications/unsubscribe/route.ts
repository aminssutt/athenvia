import { getAuthenticatedUser } from "../../authenticated-user";
import { forbiddenMutationResponse, isSameOriginMutation, privateJson } from "../../http";
import { unsubscribeFromNotifications } from "../../services";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function DELETE(request: Request): Promise<Response> {
  if (!isSameOriginMutation(request)) {
    return forbiddenMutationResponse();
  }

  const user = await getAuthenticatedUser();

  if (!user) {
    return privateJson({ error: "Authentication required." }, { status: 401 });
  }

  await unsubscribeFromNotifications(user.id);
  return privateJson({ ok: true });
}
