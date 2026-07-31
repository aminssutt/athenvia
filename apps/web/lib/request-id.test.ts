import { describe, expect, it } from "vitest";

import { requestIdFromRequest, validRequestId } from "./request-id";

describe("request correlation IDs", () => {
  it("keeps a canonical UUID supplied by a trusted proxy hop", () => {
    expect(validRequestId("018F5C42-77E0-7B4A-9A3D-8B66E7E5A111")).toBe(
      "018f5c42-77e0-7b4a-9a3d-8b66e7e5a111",
    );
  });

  it("rejects arbitrary or multi-value identifiers", () => {
    expect(validRequestId("applicant@example.test")).toBeNull();
    expect(validRequestId(["not-a-uuid", "018f5c42-77e0-7b4a-9a3d-8b66e7e5a111"])).toBeNull();
  });

  it("generates a safe identifier when Proxy did not provide one", () => {
    const requestId = requestIdFromRequest(new Request("https://athenvia.test/api/health"));
    expect(validRequestId(requestId)).toBe(requestId);
  });
});
