import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { isValidAuthCsrfToken } from "./auth-csrf";

describe("isValidAuthCsrfToken", () => {
  const secret = "test-secret-with-enough-entropy";
  const token = "csrf-token";
  const hash = createHash("sha256").update(`${token}${secret}`).digest("hex");

  it.each(["next-auth.csrf-token", "__Host-next-auth.csrf-token"])(
    "accepts the Auth.js double-submit cookie %s",
    (cookieName) => {
      const cookie = `${cookieName}=${encodeURIComponent(`${token}|${hash}`)}`;
      expect(isValidAuthCsrfToken(cookie, token, secret)).toBe(true);
    },
  );

  it("rejects a body token that does not match the signed cookie", () => {
    const cookie = `next-auth.csrf-token=${encodeURIComponent(`${token}|${hash}`)}`;
    expect(isValidAuthCsrfToken(cookie, "attacker-token", secret)).toBe(false);
  });

  it("rejects a cookie with a forged hash", () => {
    const cookie = `next-auth.csrf-token=${encodeURIComponent(`${token}|${"0".repeat(64)}`)}`;
    expect(isValidAuthCsrfToken(cookie, token, secret)).toBe(false);
  });
});
