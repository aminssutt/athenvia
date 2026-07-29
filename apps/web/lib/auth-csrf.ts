import { createHash, timingSafeEqual } from "node:crypto";

const CSRF_COOKIE_NAMES = ["__Host-next-auth.csrf-token", "next-auth.csrf-token"];

function csrfCookieValue(cookieHeader: string | null): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) {
      continue;
    }

    const name = entry.slice(0, separator).trim();
    if (CSRF_COOKIE_NAMES.includes(name)) {
      try {
        return decodeURIComponent(entry.slice(separator + 1).trim());
      } catch {
        return null;
      }
    }
  }

  return null;
}

export function isValidAuthCsrfToken(
  cookieHeader: string | null,
  bodyToken: string,
  secret: string,
): boolean {
  const cookieValue = csrfCookieValue(cookieHeader);
  if (!cookieValue || !bodyToken || !secret) {
    return false;
  }

  const separator = cookieValue.indexOf("|");
  if (separator < 0) {
    return false;
  }

  const cookieToken = cookieValue.slice(0, separator);
  const suppliedHash = cookieValue.slice(separator + 1);
  const expectedHash = createHash("sha256").update(`${cookieToken}${secret}`).digest("hex");

  if (cookieToken !== bodyToken || suppliedHash.length !== expectedHash.length) {
    return false;
  }

  return timingSafeEqual(Buffer.from(suppliedHash), Buffer.from(expectedHash));
}
