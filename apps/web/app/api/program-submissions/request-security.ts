import { database } from "@athenvia/database";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isTrustedProgramSubmissionOrigin(request: Request): boolean {
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

export async function authenticatedProgramSubmitterId(): Promise<string | null> {
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
