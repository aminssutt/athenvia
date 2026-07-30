import { describe, expect, it } from "vitest";

import { resolveCountryCode } from "./country";

describe("resolveCountryCode", () => {
  it.each([
    ["Singapore", "SG"],
    ["France", "FR"],
    ["United Kingdom", "GB"],
    ["UK", "GB"],
    ["United States of America", "US"],
    ["South Korea", "KR"],
    ["Côte d’Ivoire", "CI"],
    ["Viet Nam", "VN"],
  ])("maps %s to %s", (country, code) => {
    expect(resolveCountryCode(country)).toBe(code);
  });

  it("rejects regions outside the country catalogue", () => {
    expect(resolveCountryCode("European Union")).toBeNull();
    expect(resolveCountryCode("Atlantis")).toBeNull();
  });
});
