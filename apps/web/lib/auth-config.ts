import type { EmailUserConfig } from "next-auth/providers/email";

export const MAGIC_LINK_MAX_AGE_SECONDS = 15 * 60;
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_UPDATE_AGE_SECONDS = 24 * 60 * 60;

type AuthEnvironment = {
  AUTH_EMAIL_SERVER?: string;
  AUTH_RESEND_API_KEY?: string;
};

type GoogleAuthEnvironment = {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
};

export type GoogleAuthConfiguration = {
  clientId: string;
  clientSecret: string;
};

export function resolveGoogleAuthConfiguration(
  environment: GoogleAuthEnvironment = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  },
): GoogleAuthConfiguration | null {
  const clientId = environment.GOOGLE_CLIENT_ID?.trim() ?? "";
  const clientSecret = environment.GOOGLE_CLIENT_SECRET?.trim() ?? "";

  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

export function hasPartialGoogleAuthConfiguration(
  environment: GoogleAuthEnvironment = {
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  },
): boolean {
  return (
    Boolean(environment.GOOGLE_CLIENT_ID?.trim()) !==
    Boolean(environment.GOOGLE_CLIENT_SECRET?.trim())
  );
}

export function isVerifiedGoogleProfile(profile: unknown): boolean {
  if (typeof profile !== "object" || profile === null) {
    return false;
  }

  const candidate = profile as { email?: unknown; email_verified?: unknown };
  return (
    candidate.email_verified === true &&
    typeof candidate.email === "string" &&
    candidate.email.trim().length > 0
  );
}

export function normalizeEmailIdentifier(identifier: string): string {
  const email = identifier.trim().toLowerCase();
  const parts = email.split("@");
  const localPart = parts[0] ?? "";
  const domain = parts[1] ?? "";

  if (
    parts.length !== 2 ||
    email.length > 254 ||
    localPart.length === 0 ||
    localPart.length > 64 ||
    domain.length === 0 ||
    domain.startsWith(".") ||
    domain.endsWith(".") ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    domain.includes("..") ||
    /[\s,;<>]/.test(email)
  ) {
    throw new Error("Invalid email address");
  }

  return email;
}

export function resolveEmailServer(
  environment: AuthEnvironment = {
    AUTH_EMAIL_SERVER: process.env.AUTH_EMAIL_SERVER,
    AUTH_RESEND_API_KEY: process.env.AUTH_RESEND_API_KEY,
  },
): EmailUserConfig["server"] {
  if (environment.AUTH_EMAIL_SERVER) {
    return environment.AUTH_EMAIL_SERVER;
  }

  if (environment.AUTH_RESEND_API_KEY) {
    return {
      host: "smtp.resend.com",
      port: 465,
      secure: true,
      auth: {
        user: "resend",
        pass: environment.AUTH_RESEND_API_KEY,
      },
    };
  }

  return "smtp://localhost:1025";
}

export function safeAuthRedirect(url: string, baseUrl: string): string {
  if (url.startsWith("/") && !url.startsWith("//")) {
    return new URL(url, baseUrl).toString();
  }

  try {
    const destination = new URL(url);
    if (destination.origin === new URL(baseUrl).origin) {
      return destination.toString();
    }
  } catch {
    // Invalid and non-HTTP destinations fall through to the safe app home.
  }

  return new URL("/home", baseUrl).toString();
}
