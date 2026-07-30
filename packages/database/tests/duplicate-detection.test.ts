import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  catalogueNameSimilarity,
  normalizeCatalogueName,
  normalizeOfficialDomain,
  normalizeOfficialUrl,
} from "../src/catalogue-normalization";
import {
  createDuplicateReview,
  detectProgramDuplicateCandidates,
  detectUniversityDuplicateCandidates,
} from "../src/duplicate-detection";

const firstId = "0b5fc507-68e9-4b0e-9167-617757dcdd0e";
const secondId = "5bd680ef-09be-4030-b917-4df1531372b9";

describe("catalogue normalization", () => {
  it("uses one Unicode, punctuation, ampersand and whitespace strategy", () => {
    assert.equal(
      normalizeCatalogueName("  École\u00a0Polytechnique — Data & A.I.  "),
      "ecole polytechnique data and a i",
    );
    assert.equal(normalizeCatalogueName("Ｆｕｌｌ－Ｗｉｄｔｈ"), "full width");
  });

  it("normalizes official domains without accepting unrelated protocols", () => {
    assert.equal(normalizeOfficialDomain("https://WWW.Example.EDU/admissions"), "example.edu");
    assert.equal(normalizeOfficialDomain("example.edu."), "example.edu");
    assert.equal(normalizeOfficialDomain("mailto:admissions@example.edu"), null);
    assert.equal(
      normalizeOfficialUrl("https://www.example.edu/program/apply/?utm_source=test"),
      "example.edu/program/apply",
    );
    assert.equal(normalizeOfficialUrl("https://user@example.edu/program"), null);
  });

  it("provides a deterministic fuzzy signal without equating unrelated names", () => {
    assert.ok(
      catalogueNameSimilarity(
        "Massachusetts Institute of Technology",
        "Massachusetts Inst. of Technology",
      ) > 0.8,
    );
    assert.ok(catalogueNameSimilarity("Oxford University", "Tokyo Institute") < 0.5);
  });
});

describe("duplicate candidate detection", () => {
  it("matches university names, aliases and domains without merging records", () => {
    const records = [
      {
        aliases: [{ alias: "NUS" }],
        countryCode: "SG",
        id: firstId,
        name: "National University of Singapore",
        officialDomain: "nus.edu.sg",
        officialWebsite: "https://nus.edu.sg/",
      },
      {
        aliases: [],
        countryCode: "US",
        id: secondId,
        name: "Unrelated College",
        officialDomain: "unrelated.example",
        officialWebsite: null,
      },
    ];

    const aliasMatch = detectUniversityDuplicateCandidates(
      { countryCode: "SG", name: "NUS" },
      records,
    );
    assert.deepEqual(
      aliasMatch.map(({ id }) => id),
      [firstId],
    );
    assert.ok(aliasMatch[0]?.reasons.includes("normalized-alias"));

    const domainMatch = detectUniversityDuplicateCandidates(
      {
        countryCode: "FR",
        name: "Different display name",
        officialWebsite: "https://www.nus.edu.sg/apply",
      },
      records,
    );
    assert.deepEqual(
      domainMatch.map(({ id }) => id),
      [firstId],
    );
    assert.ok(domainMatch[0]?.reasons.includes("official-domain"));
  });

  it("keeps only likely same-university and same-degree program matches", () => {
    const candidates = detectProgramDuplicateCandidates(
      {
        degreeType: "MASTER",
        name: "MSc Artificial Intelligence",
        officialUrl: "https://cs.example.edu/msc-ai/apply?ref=catalogue",
        universityId: firstId,
      },
      [
        {
          degreeType: "MASTER",
          id: secondId,
          name: "MSc in Artificial Intelligence",
          officialUrl: "https://cs.example.edu/msc-ai/apply",
          universityId: firstId,
        },
        {
          degreeType: "PHD",
          id: "9708c9b1-c59d-41d3-9ba0-d9a9e5402bf0",
          name: "Artificial Intelligence",
          officialUrl: null,
          universityId: firstId,
        },
      ],
    );

    assert.deepEqual(
      candidates.map(({ id }) => id),
      [secondId],
    );
    assert.ok(candidates[0]?.reasons.includes("official-url"));
    assert.ok(candidates[0]?.reasons.includes("similar-name"));
  });

  it("creates pending review evidence only when candidates exist", async () => {
    const writes: unknown[] = [];
    const client = {
      dataRevision: {
        create: async (args: unknown) => {
          writes.push(args);
          return { id: "c33b355a-5167-46eb-8e4f-61c409b1c13a" };
        },
      },
    } as never;

    assert.equal(await createDuplicateReview(client, "UNIVERSITY_SUBMISSION", firstId, []), null);
    assert.equal(writes.length, 0);

    const reviewId = await createDuplicateReview(client, "UNIVERSITY_SUBMISSION", firstId, [
      {
        id: secondId,
        name: "Candidate",
        reasons: ["normalized-name"],
        score: 1,
      },
    ]);
    assert.equal(reviewId, "c33b355a-5167-46eb-8e4f-61c409b1c13a");
    assert.equal(writes.length, 1);
    assert.match(JSON.stringify(writes[0]), /duplicate_candidates/u);
    assert.doesNotMatch(JSON.stringify(writes[0]), /Candidate/u);
  });
});
