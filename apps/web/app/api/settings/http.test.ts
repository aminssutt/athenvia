import { afterEach, describe, expect, it } from "vitest";

import { isSameOriginMutation, privateJson } from "./http";

describe("settings request protection", () => {
  const initialNextAuthUrl = process.env.NEXTAUTH_URL;

  afterEach(() => {
    if (initialNextAuthUrl === undefined) {
      delete process.env.NEXTAUTH_URL;
    } else {
      process.env.NEXTAUTH_URL = initialNextAuthUrl;
    }
  });

  it("accepts an exact same-origin mutation", () => {
    const request = new Request("https://athenvia.example/api/settings/account", {
      headers: {
        origin: "https://athenvia.example",
        "sec-fetch-site": "same-origin",
      },
      method: "DELETE",
    });

    expect(isSameOriginMutation(request)).toBe(true);
  });

  it.each([
    ["a missing origin", {}],
    ["a cross-site origin", { origin: "https://attacker.example" }],
    [
      "a same-site subdomain",
      {
        origin: "https://preview.athenvia.example",
        "sec-fetch-site": "same-site",
      },
    ],
    [
      "an explicitly cross-site request",
      {
        origin: "https://athenvia.example",
        "sec-fetch-site": "cross-site",
      },
    ],
  ])("rejects %s", (_name, headers) => {
    const request = new Request("https://athenvia.example/api/settings/account", {
      headers,
      method: "DELETE",
    });

    expect(isSameOriginMutation(request)).toBe(false);
  });

  it("marks private responses as non-cacheable", async () => {
    const response = privateJson({ ok: true });

    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("does not trust a Host-derived origin when the public origin is configured", () => {
    process.env.NEXTAUTH_URL = "https://app.athenvia.example";
    const request = new Request("https://attacker.example/api/settings/account", {
      headers: {
        origin: "https://attacker.example",
        "sec-fetch-site": "same-origin",
      },
      method: "DELETE",
    });

    expect(isSameOriginMutation(request)).toBe(false);
  });
});
