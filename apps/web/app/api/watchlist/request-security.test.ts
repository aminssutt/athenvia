import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@athenvia/database", () => ({
  database: {
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

import { isTrustedMutationOrigin } from "./request-security";

const endpoint = "https://athenvia.test/api/watchlist";

function request(origin?: string, fetchSite?: string): Request {
  const headers = new Headers();
  if (origin) {
    headers.set("Origin", origin);
  }
  if (fetchSite) {
    headers.set("Sec-Fetch-Site", fetchSite);
  }

  return new Request(endpoint, {
    method: "POST",
    headers,
  });
}

describe("watchlist mutation origin checks", () => {
  const initialNextAuthUrl = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (initialNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = initialNextAuthUrl;
    }
  });

  it("accepts this deployment's exact origin", () => {
    expect(isTrustedMutationOrigin(request("https://athenvia.test", "same-origin"))).toBe(true);
  });

  it("rejects missing, opaque and cross-site origins", () => {
    expect(isTrustedMutationOrigin(request())).toBe(false);
    expect(isTrustedMutationOrigin(request("null"))).toBe(false);
    expect(isTrustedMutationOrigin(request("https://attacker.test", "cross-site"))).toBe(false);
  });

  it("rejects contradictory Fetch Metadata even with a matching Origin", () => {
    expect(isTrustedMutationOrigin(request("https://athenvia.test", "cross-site"))).toBe(false);
  });

  it("accepts the configured public origin behind a trusted proxy", () => {
    process.env.NEXTAUTH_URL = "https://app.athenvia.example/sign-in";

    expect(
      isTrustedMutationOrigin(
        new Request("http://web:3000/api/watchlist", {
          method: "POST",
          headers: {
            Origin: "https://app.athenvia.example",
            "Sec-Fetch-Site": "same-origin",
          },
        }),
      ),
    ).toBe(true);
  });

  it("does not trust a request Host-derived origin when a canonical origin is configured", () => {
    process.env.NEXTAUTH_URL = "https://app.athenvia.example";

    expect(
      isTrustedMutationOrigin(
        new Request("https://attacker.test/api/watchlist", {
          method: "POST",
          headers: {
            Origin: "https://attacker.test",
            "Sec-Fetch-Site": "same-origin",
          },
        }),
      ),
    ).toBe(false);
  });
});
