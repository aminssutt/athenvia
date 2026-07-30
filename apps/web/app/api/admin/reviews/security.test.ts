import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@athenvia/database", () => ({
  database: { user: { findUnique: vi.fn() } },
}));

import { isTrustedAdminWrite, parseAdminEmails } from "./security";

describe("admin review security", () => {
  const initialNextAuthUrl = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (initialNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = initialNextAuthUrl;
    }
  });

  it("normalizes a closed explicit administrator allowlist", () => {
    expect([...parseAdminEmails(" Admin@Example.com,reviewer@example.com, ")]).toEqual([
      "admin@example.com",
      "reviewer@example.com",
    ]);
    expect(parseAdminEmails(undefined).size).toBe(0);
  });

  it("rejects missing, malformed, and cross-origin writes", () => {
    process.env.NEXTAUTH_URL = "https://app.athenvia.example/sign-in";
    expect(
      isTrustedAdminWrite(
        new Request("https://internal.example/api/admin/reviews/1", { method: "POST" }),
      ),
    ).toBe(false);
    expect(
      isTrustedAdminWrite(
        new Request("https://internal.example/api/admin/reviews/1", {
          headers: { origin: "not a url" },
          method: "POST",
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedAdminWrite(
        new Request("https://internal.example/api/admin/reviews/1", {
          headers: { origin: "https://attacker.example" },
          method: "POST",
        }),
      ),
    ).toBe(false);
  });

  it("trusts only the configured public origin", () => {
    process.env.NEXTAUTH_URL = "https://app.athenvia.example/sign-in";
    expect(
      isTrustedAdminWrite(
        new Request("https://internal.example/api/admin/reviews/1", {
          headers: { origin: "https://app.athenvia.example" },
          method: "POST",
        }),
      ),
    ).toBe(true);
  });
});
