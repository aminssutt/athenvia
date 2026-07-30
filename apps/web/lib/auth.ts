import { database } from "@athenvia/database";
import { PrismaAdapter } from "@auth/prisma-adapter";
import type { NextAuthOptions } from "next-auth";
import EmailProvider from "next-auth/providers/email";
import GoogleProvider from "next-auth/providers/google";

import {
  hasPartialGoogleAuthConfiguration,
  isVerifiedGoogleProfile,
  MAGIC_LINK_MAX_AGE_SECONDS,
  normalizeEmailIdentifier,
  resolveGoogleAuthConfiguration,
  resolveEmailServer,
  safeAuthRedirect,
  SESSION_MAX_AGE_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
} from "@/lib/auth-config";
import { sendMagicLink } from "@/lib/auth-email";

const googleAuthConfiguration = resolveGoogleAuthConfiguration();
const providers: NextAuthOptions["providers"] = [
  EmailProvider({
    from: process.env.AUTH_EMAIL_FROM ?? "Athenvia <noreply@localhost>",
    maxAge: MAGIC_LINK_MAX_AGE_SECONDS,
    normalizeIdentifier: normalizeEmailIdentifier,
    sendVerificationRequest: sendMagicLink,
    server: resolveEmailServer(),
  }),
];

if (googleAuthConfiguration) {
  providers.unshift(
    GoogleProvider({
      ...googleAuthConfiguration,
      allowDangerousEmailAccountLinking: true,
    }),
  );
} else if (hasPartialGoogleAuthConfiguration()) {
  console.warn("[auth] Google OAuth disabled: configure both credential variables.");
}

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(database),
  secret: process.env.AUTH_SECRET,
  session: {
    strategy: "database",
    maxAge: SESSION_MAX_AGE_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  providers,
  pages: {
    error: "/sign-in",
    signIn: "/sign-in",
    verifyRequest: "/sign-in/check-email",
  },
  callbacks: {
    signIn({ account, profile }) {
      return account?.provider !== "google" || isVerifiedGoogleProfile(profile);
    },
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
