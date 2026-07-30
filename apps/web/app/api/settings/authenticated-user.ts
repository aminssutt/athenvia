import { database } from "@athenvia/database";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

export type AuthenticatedUser = {
  email: string;
  id: string;
};

export async function getAuthenticatedUser(): Promise<AuthenticatedUser | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;

  if (!email) {
    return null;
  }

  return database.user.findUnique({
    where: { email },
    select: {
      email: true,
      id: true,
    },
  });
}
