import { database } from "@athenvia/database";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

const MUTATION_RESPONSE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
} as const;

export function mutationResponseHeaders(): HeadersInit {
  return MUTATION_RESPONSE_HEADERS;
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Cookie-authenticated mutations must originate from this deployment.
 *
 * Browsers send Origin on JSON POST and DELETE requests. Rejecting a missing
 * origin also prevents non-browser callers from accidentally treating the
 * session cookie as a bearer credential.
 */
export function isTrustedMutationOrigin(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return false;
  }

  const suppliedOrigin = request.headers.get("origin");
  if (!suppliedOrigin) {
    return false;
  }

  const requestOrigin = normalizedOrigin(request.url);
  const configuredOrigin = process.env.NEXTAUTH_URL
    ? normalizedOrigin(process.env.NEXTAUTH_URL)
    : null;
  const trustedOrigin = configuredOrigin ?? requestOrigin;

  return Boolean(trustedOrigin && trustedOrigin === normalizedOrigin(suppliedOrigin));
}

/**
 * Resolves ownership from the authenticated database session, never from input.
 */
export async function authenticatedUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return null;
  }

  const user = await database.user.findUnique({
    where: { email },
    select: { id: true },
  });

  return user?.id ?? null;
}
