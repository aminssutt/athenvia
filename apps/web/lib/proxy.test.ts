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

  it("targets only API requests", () => {
    expect(config.matcher).toBe("/api/:path*");
  });
});
