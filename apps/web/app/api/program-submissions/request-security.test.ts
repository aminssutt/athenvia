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

import { isTrustedProgramSubmissionOrigin } from "./request-security";

function request(origin?: string, fetchSite?: string): Request {
  const headers = new Headers();
  if (origin) {
    headers.set("Origin", origin);
  }
  if (fetchSite) {
    headers.set("Sec-Fetch-Site", fetchSite);
  }
  return new Request("https://athenvia.test/api/program-submissions", {
    method: "POST",
    headers,
  });
}

describe("program submission origin checks", () => {
  const initialNextAuthUrl = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (initialNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = initialNextAuthUrl;
    }
  });

  it("accepts the deployment origin", () => {
    expect(isTrustedProgramSubmissionOrigin(request("https://athenvia.test", "same-origin"))).toBe(
      true,
    );
  });

  it("rejects missing, opaque, and cross-site origins", () => {
    expect(isTrustedProgramSubmissionOrigin(request())).toBe(false);
    expect(isTrustedProgramSubmissionOrigin(request("null"))).toBe(false);
    expect(isTrustedProgramSubmissionOrigin(request("https://attacker.test", "cross-site"))).toBe(
      false,
    );
  });

  it("accepts NEXTAUTH_URL as the public origin behind a proxy", () => {
    process.env.NEXTAUTH_URL = "https://app.athenvia.example/sign-in";
    const proxiedRequest = new Request("http://web:3000/api/program-submissions", {
      method: "POST",
      headers: {
        Origin: "https://app.athenvia.example",
        "Sec-Fetch-Site": "same-origin",
      },
    });

    expect(isTrustedProgramSubmissionOrigin(proxiedRequest)).toBe(true);
  });

  it("does not trust a Host-derived origin when NEXTAUTH_URL is configured", () => {
    process.env.NEXTAUTH_URL = "https://app.athenvia.example";
    const spoofedRequest = new Request("https://attacker.test/api/program-submissions", {
      method: "POST",
      headers: {
        Origin: "https://attacker.test",
        "Sec-Fetch-Site": "same-origin",
      },
    });

    expect(isTrustedProgramSubmissionOrigin(spoofedRequest)).toBe(false);
  });
});
