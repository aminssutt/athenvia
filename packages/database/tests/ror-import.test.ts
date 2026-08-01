import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  mapRorRecord,
  planRorImport,
  type ExistingUniversity,
  type RorRecord,
} from "../src/ror-import";

function record(overrides: Partial<RorRecord> = {}): RorRecord {
  return {
    id: "https://ror.org/042nb2s44",
    status: "active",
    types: ["education"],
    names: [
      { value: "Massachusetts Institute of Technology", types: ["ror_display", "label"] },
      { value: "MIT", types: ["acronym"] },
      { value: "Instituto Tecnológico de Massachusetts", types: ["label"], lang: "es" },
    ],
    links: [
      { type: "website", value: "https://web.mit.edu" },
      { type: "wikipedia", value: "https://en.wikipedia.org/wiki/MIT" },
    ],
    domains: ["mit.edu"],
    locations: [{ geonames_details: { country_code: "US", name: "Cambridge" } }],
    ...overrides,
  };
}

describe("mapRorRecord", () => {
  it("maps an active education record to an importable university", () => {
    const candidate = mapRorRecord(record());
    assert.ok(candidate);
    assert.equal(candidate.rorId, "https://ror.org/042nb2s44");
    assert.equal(candidate.name, "Massachusetts Institute of Technology");
    assert.equal(candidate.normalizedName, "massachusetts institute of technology");
    assert.equal(candidate.countryCode, "US");
    assert.equal(candidate.city, "Cambridge");
    assert.equal(candidate.officialDomain, "mit.edu");
    assert.equal(candidate.officialWebsite, "https://web.mit.edu");
    assert.deepEqual(
      candidate.aliases.map((alias) => alias.alias),
      ["MIT", "Instituto Tecnológico de Massachusetts"],
    );
  });

  it("rejects records outside the catalogue scope", () => {
    assert.equal(mapRorRecord(record({ status: "inactive" })), null);
    assert.equal(mapRorRecord(record({ status: "withdrawn" })), null);
    assert.equal(mapRorRecord(record({ types: ["facility"] })), null);
    assert.equal(mapRorRecord(record({ locations: [] })), null);
    assert.equal(
      mapRorRecord(record({ locations: [{ geonames_details: { country_code: "USA" } }] })),
      null,
    );
    assert.equal(mapRorRecord(record({ names: [{ value: "MIT", types: ["acronym"] }] })), null);
  });

  it("derives the official domain from the website when domains are empty", () => {
    const candidate = mapRorRecord(record({ domains: [] }));
    assert.ok(candidate);
    assert.equal(candidate.officialDomain, "web.mit.edu");
  });

  it("drops invalid websites instead of importing them", () => {
    const candidate = mapRorRecord(
      record({ domains: [], links: [{ type: "website", value: "not a url" }] }),
    );
    assert.ok(candidate);
    assert.equal(candidate.officialWebsite, null);
    assert.equal(candidate.officialDomain, null);
  });

  it("deduplicates aliases and skips ones equal to the display name", () => {
    const candidate = mapRorRecord(
      record({
        names: [
          { value: "Sorbonne Université", types: ["ror_display", "label"], lang: "fr" },
          { value: "Sorbonne Universite", types: ["label"] },
          { value: "SU", types: ["acronym"] },
          { value: "su", types: ["alias"] },
        ],
      }),
    );
    assert.ok(candidate);
    assert.deepEqual(
      candidate.aliases.map((alias) => alias.alias),
      ["SU"],
    );
  });
});

describe("planRorImport", () => {
  const existing: ExistingUniversity[] = [
    {
      id: "8b7f4c1e-0000-5000-8000-000000000001",
      normalizedName: "massachusetts institute of technology",
      countryCode: "US",
      city: null,
      officialDomain: "mit.edu",
      officialWebsite: null,
    },
  ];

  it("adopts existing universities and only fills their null fields", () => {
    const candidate = mapRorRecord(record());
    assert.ok(candidate);
    const plan = planRorImport([candidate], existing);

    assert.equal(plan.creates.length, 0);
    assert.equal(plan.adoptions.length, 1);
    const adoption = plan.adoptions[0]!;
    assert.equal(adoption.universityId, existing[0]!.id);
    assert.deepEqual(adoption.fill, {
      city: "Cambridge",
      officialWebsite: "https://web.mit.edu",
    });
    assert.ok(plan.aliases.every((alias) => alias.universityId === existing[0]!.id));
    assert.equal(plan.sources.length, 1);
    assert.equal(plan.sources[0]!.url, "https://ror.org/042nb2s44");
  });

  it("creates new universities with deterministic identifiers", () => {
    const candidate = mapRorRecord(record());
    assert.ok(candidate);
    const first = planRorImport([candidate], []);
    const second = planRorImport([candidate], []);

    assert.equal(first.creates.length, 1);
    assert.equal(first.creates[0]!.id, second.creates[0]!.id);
    assert.deepEqual(
      first.aliases.map((alias) => alias.id),
      second.aliases.map((alias) => alias.id),
    );
    assert.equal(first.sources[0]!.id, second.sources[0]!.id);
  });

  it("skips registry records that collapse onto the same natural key", () => {
    const first = mapRorRecord(record());
    const second = mapRorRecord(
      record({
        id: "https://ror.org/zzzduplicate",
        names: [
          { value: "Massachusetts Institute of Technology", types: ["ror_display"] },
          { value: "Duplicate", types: ["alias"] },
        ],
      }),
    );
    assert.ok(first && second);
    const plan = planRorImport([first, second], []);

    assert.equal(plan.creates.length, 1);
    assert.equal(plan.skippedDuplicates, 1);
    assert.equal(plan.creates[0]!.rorId, "https://ror.org/042nb2s44");
  });
});
