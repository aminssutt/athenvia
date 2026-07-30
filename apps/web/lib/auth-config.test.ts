import { describe, expect, it } from "vitest";

import { normalizeEmailIdentifier, resolveEmailServer, safeAuthRedirect } from "./auth-config";

describe("normalizeEmailIdentifier", () => {
  it("normalizes case and surrounding whitespace", () => {
    expect(normalizeEmailIdentifier("  Student@Example.COM ")).toBe("student@example.com");
  });

  it.each([
    "student",
    "a@example.com@example.org",
    "@example.com",
    "student@",
    "first,second@example.com",
    "first;second@example.com",
    "student @example.com",
  ])("rejects invalid or multi-recipient input: %s", (identifier) => {
    expect(() => normalizeEmailIdentifier(identifier)).toThrow("Invalid email address");
  });
});

describe("resolveEmailServer", () => {
  it("prefers an explicit SMTP URL", () => {
    expect(
      resolveEmailServer({
        AUTH_EMAIL_SERVER: "smtp://mail.example.test:2525",
        AUTH_RESEND_API_KEY: "re_test",
      }),
    ).toBe("smtp://mail.example.test:2525");
  });

  it("maps a Resend key to its TLS SMTP relay", () => {
    expect(resolveEmailServer({ AUTH_RESEND_API_KEY: "re_test" })).toEqual({
      auth: { pass: "re_test", user: "resend" },
      host: "smtp.resend.com",
      port: 465,
      secure: true,
    });
  });

  it("uses the local capture server when no delivery secret is set", () => {
    expect(resolveEmailServer({})).toBe("smtp://localhost:1025");
  });
});

describe("safeAuthRedirect", () => {
  const baseUrl = "https://athenvia.example";

  it("allows relative and same-origin destinations", () => {
    expect(safeAuthRedirect("/home?from=auth", baseUrl)).toBe(
      "https://athenvia.example/home?from=auth",
    );
    expect(safeAuthRedirect("https://athenvia.example/privacy", baseUrl)).toBe(
      "https://athenvia.example/privacy",
    );
  });

  it.each([
    "https://attacker.example/collect",
    "//attacker.example/collect",
    "javascript:alert(1)",
    "not a url",
  ])("rejects unsafe destination %s", (destination) => {
    expect(safeAuthRedirect(destination, baseUrl)).toBe("https://athenvia.example/home");
  });
});
