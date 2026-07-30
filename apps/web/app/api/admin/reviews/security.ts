import { database } from "@athenvia/database";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

export type AdminPrincipal = {
  email: string;
  id: string;
};

export type AdminAccess =
  | { principal: AdminPrincipal; status: "AUTHORIZED" }
  | { status: "FORBIDDEN" }
  | { status: "UNAUTHENTICATED" };

export function parseAdminEmails(value: string | undefined): ReadonlySet<string> {
  return new Set(
    (value ?? "")
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}

export async function resolveAdminAccess(): Promise<AdminAccess> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email) {
    return { status: "UNAUTHENTICATED" };
  }
  if (!parseAdminEmails(process.env.ATHENVIA_ADMIN_EMAILS).has(email)) {
    return { status: "FORBIDDEN" };
  }
  const user = await database.user.findUnique({
    where: { email },
    select: { email: true, id: true },
  });
  return user ? { principal: user, status: "AUTHORIZED" } : { status: "UNAUTHENTICATED" };
}

export function isTrustedAdminWrite(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) {
    return false;
  }
  const expectedOrigin = process.env.NEXTAUTH_URL
    ? new URL(process.env.NEXTAUTH_URL).origin
    : new URL(request.url).origin;
  try {
    return new URL(origin).origin === expectedOrigin;
  } catch {
    return false;
  }
}
