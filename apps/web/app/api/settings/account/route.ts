import { getAuthenticatedUser } from "../authenticated-user";
import { forbiddenMutationResponse, isSameOriginMutation, privateJson } from "../http";
import { deleteAccountSchema } from "../schemas";
import { anonymizeAccount } from "../services";

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

  let input: unknown;

  try {
    input = await request.json();
  } catch {
    return privateJson({ error: "A valid JSON body is required." }, { status: 400 });
  }

  const parsed = deleteAccountSchema.safeParse(input);

  if (!parsed.success) {
    return privateJson({ error: "Type DELETE to confirm account deletion." }, { status: 400 });
  }

  await anonymizeAccount(user);
  return privateJson({ ok: true });
}
