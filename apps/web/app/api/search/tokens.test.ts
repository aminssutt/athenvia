import { describe, expect, it } from "vitest";

import { searchQueryTokens } from "./tokens";

describe("search query tokens", () => {
  it("lowercases, unaccents and splits on non-alphanumerics", () => {
    expect(searchQueryTokens("École Polytechnique")).toEqual(["ecole", "polytechnique"]);
  });

  it("drops short connectives when a significant token exists", () => {
    expect(searchQueryTokens("université de lyon")).toEqual(["universite", "lyon"]);
  });

  it("keeps short tokens when nothing longer exists", () => {
    expect(searchQueryTokens("ku")).toEqual(["ku"]);
  });

  it("deduplicates repeated words", () => {
    expect(searchQueryTokens("lyon lyon lyon")).toEqual(["lyon"]);
  });

  it("returns nothing for queries without latin letters or digits", () => {
    expect(searchQueryTokens("清华大学")).toEqual([]);
  });

  it("caps the token count", () => {
    expect(searchQueryTokens("one two three four five six seven eight")).toHaveLength(6);
  });

  it("only ever produces characters safe for regex and LIKE patterns", () => {
    for (const token of searchQueryTokens("a%b_c\\d (e) [f] *g* .h. |i| l'école")) {
      expect(token).toMatch(/^[a-z0-9]+$/u);
    }
  });
});
