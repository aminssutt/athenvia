import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { config, proxy } from "../proxy";
import { REQUEST_ID_HEADER, validRequestId } from "./request-id";

describe("API request correlation Proxy", () => {
  it("replaces a client identifier and returns one safe response identifier", () => {
    const request = new NextRequest("https://athenvia.test/api/search", {
      headers: {
        authorization: "Bearer private",
        cookie: "session=private",
        [REQUEST_ID_HEADER]: "018f5c42-77e0-7b4a-9a3d-8b66e7e5a111",
      },
    });

    const response = proxy(request);
    const requestId = response.headers.get(REQUEST_ID_HEADER);

    expect(validRequestId(requestId)).toBe(requestId);
    expect(requestId).not.toBe("018f5c42-77e0-7b4a-9a3d-8b66e7e5a111");
    expect(response.headers.get(`x-middleware-request-${REQUEST_ID_HEADER}`)).toBe(requestId);
    expect(response.headers.has("authorization")).toBe(false);
    expect(response.headers.has("cookie")).toBe(false);
  });

  it("keeps only the reverse-proxy hop of the forwarding headers", () => {
    const request = new NextRequest("https://athenvia.test/api/search", {
      headers: {
        "cf-connecting-ip": "6.6.6.6",
        "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9",
        "x-real-ip": "6.6.6.6",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-request-x-forwarded-for")).toBe("203.0.113.9");
    expect(response.headers.get("x-middleware-request-x-real-ip")).toBe("203.0.113.9");
    expect(response.headers.get("x-middleware-request-cf-connecting-ip")).toBeNull();
  });

  it("drops client address headers entirely when no proxy hop exists", () => {
    const request = new NextRequest("https://athenvia.test/api/search", {
      headers: {
        "cf-connecting-ip": "6.6.6.6",
        "x-real-ip": "6.6.6.6",
      },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-request-x-forwarded-for")).toBeNull();
    expect(response.headers.get("x-middleware-request-x-real-ip")).toBeNull();
    expect(response.headers.get("x-middleware-request-cf-connecting-ip")).toBeNull();
  });

  it("targets only API requests", () => {
    expect(config.matcher).toBe("/api/:path*");
  });
});
