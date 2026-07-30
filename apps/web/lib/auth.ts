import { database } from "@athenvia/database";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";

import {
  MAGIC_LINK_MAX_AGE_SECONDS,
  normalizeEmailIdentifier,
  resolveEmailServer,
  safeAuthRedirect,
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/lib/auth-config";
import { sendMagicLink } from "@/lib/auth-email";

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(database),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  providers: [
    EmailProvider({
      from: process.env.AUTH_EMAIL_FROM ?? "Athenvia <noreply@localhost>",
      maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
      normalizeIdentifier: normalizeEmailIdentifier,
      sendVerificationRequest: sendMagicLink,
      server: resolveEmailServer(),
    }),
  ],
  pages: {
    error: "/sign-in",
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  callbacks: {
    redirect({ url, baseUrl }) {
      return safeAuthRedirect(url, baseUrl);
    },
  },
  logger: {
    error(code) {
      console.error(`[auth] ${code}`);
    },
    warn(code) {
      console.warn(`[auth] ${code}`);
    },
    debug() {
      // Authentication debug payloads can contain personal data. Never log them.
    },
  },
  theme: {
    brandColor: "#493126",
    buttonText: "#ffffff",
    colorScheme: "light",
  },
  useSecureCookies: process.env.NODE_ENV === "production",
};
