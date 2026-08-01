import { describe, expect, it } from "vitest";

import { getUniversityLogoAsset } from "./university-logo-assets";

describe("getUniversityLogoAsset", () => {
  it("resolves every launch-catalogue university name as seeded", () => {
    const seededNames = [
      "Columbia University",
      "Cornell Tech",
      "École Polytechnique",
      "École Polytechnique Fédérale de Lausanne",
      "ETH Zurich",
      "HEC Paris",
      "Imperial College London",
      "Korea Advanced Institute of Science and Technology",
      "Massachusetts Institute of Technology",
      "Nanyang Technological University",
      "National University of Singapore",
      "Seoul National University",
      "Singapore Management University",
      "The Hong Kong University of Science and Technology",
      "The University of Hong Kong",
      "Tsinghua University",
      "University College London",
      "University of California, Berkeley",
      "University of California, Los Angeles",
      "University of Cambridge",
      "University of Oxford",
    ];

    for (const name of seededNames) {
      expect(getUniversityLogoAsset(name), name).toMatch(/^\/university-logos\/[a-z-]+\.png$/);
    }
  });

  it("ignores case, punctuation and diacritics", () => {
    expect(getUniversityLogoAsset("ETH Zürich")).toBe("/university-logos/eth-zurich.png");
    expect(getUniversityLogoAsset("ecole polytechnique")).toBe(
      "/university-logos/polytechnique.png",
    );
    expect(getUniversityLogoAsset("university of cambridge")).toBe(
      "/university-logos/cambridge.png",
    );
  });

  it("resolves the short-form aliases marketing copy uses", () => {
    expect(getUniversityLogoAsset("EPFL")).toBe("/university-logos/epfl.png");
    expect(getUniversityLogoAsset("UCL")).toBe("/university-logos/ucl.png");
    expect(getUniversityLogoAsset("UC Berkeley")).toBe("/university-logos/berkeley.png");
    expect(getUniversityLogoAsset("UCLA")).toBe("/university-logos/ucla.png");
  });

  it("returns null for universities without a bundled mark", () => {
    expect(getUniversityLogoAsset("Unknown Tech Institute")).toBeNull();
    expect(getUniversityLogoAsset("")).toBeNull();
  });
});
