import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractDateCandidates } from "./dates";

type Fixture = {
  automatic: boolean;
  date?: string;
  kind: string;
  name: string;
  text: string;
  time?: string;
};

const fixtures = JSON.parse(
  await readFile(new URL("./fixtures/date-cases.json", import.meta.url), "utf8"),
) as Fixture[];

for (const fixture of fixtures) {
  test(`extracts ${fixture.name} deterministically`, () => {
    const first = extractDateCandidates(fixture.text, {
      timeZone: "Europe/Paris",
      referenceDate: new Date("2026-07-30T00:00:00.000Z"),
    });
    const second = extractDateCandidates(fixture.text, {
      timeZone: "Europe/Paris",
      referenceDate: new Date("2026-07-30T00:00:00.000Z"),
    });

    assert.deepEqual(first, second);
    assert.equal(first.length, 1);
    assert.equal(first[0]?.kind, fixture.kind);
    assert.equal(first[0]?.localDate, fixture.date ?? null);
    assert.equal(first[0]?.localTime, fixture.time ?? null);
    assert.equal(first[0]?.automaticPublication, fixture.automatic);
    assert.equal(first[0]?.timeZone, "Europe/Paris");
  });
}

test("keeps both interpretations of an ambiguous numeric date", () => {
  const [candidate] = extractDateCandidates("Apply by 03/04/2027.", {
    timeZone: "UTC",
    referenceDate: new Date("2026-07-30T00:00:00.000Z"),
  });

  assert.equal(candidate?.localDate, null);
  assert.deepEqual(candidate?.alternatives, ["2027-03-04", "2027-04-03"]);
  assert.ok(candidate?.reviewReasons.includes("AMBIGUOUS_NUMERIC_ORDER"));
  assert.equal(candidate?.automaticPublication, false);
});

test("accepts an explicit source numeric order without guessing", () => {
  const [candidate] = extractDateCandidates("Apply by 03/04/2027.", {
    numericDateOrder: "DMY",
    timeZone: "Europe/London",
  });

  assert.equal(candidate?.localDate, "2027-04-03");
  assert.equal(candidate?.automaticPublication, true);
});

test("uses document UTC but reviews ambiguous timezone abbreviations", () => {
  const [utc] = extractDateCandidates("The deadline is 15 January 2027 at 17:00 UTC.", {
    timeZone: "Europe/Paris",
  });
  assert.equal(utc?.timeZone, "UTC");
  assert.equal(utc?.timeZoneSource, "document");
  assert.equal(utc?.automaticPublication, true);

  const [abbreviated] = extractDateCandidates("The deadline is 15 January 2027 at 5:00 p.m. ET.", {
    timeZone: "America/New_York",
  });
  assert.equal(abbreviated?.timeZone, "America/New_York");
  assert.ok(abbreviated?.reviewReasons.includes("TIMEZONE_ABBREVIATION"));
  assert.equal(abbreviated?.automaticPublication, false);
});

test("never auto-publishes invalid, inferred, context-free, or conflicting candidates", () => {
  const cases = [
    "Deadline: 31 February 2027.",
    "Applications open January 15.",
    "The meeting is 15 January 2027.",
    "Applications open and close 15 January 2027.",
  ];

  for (const text of cases) {
    const candidates = extractDateCandidates(text, {
      referenceDate: new Date("2026-07-30T00:00:00.000Z"),
      timeZone: "UTC",
    });
    assert.ok(candidates.length > 0, text);
    assert.equal(
      candidates.some(({ automaticPublication }) => automaticPublication),
      false,
      text,
    );
  }
});

test("rejects invalid configuration and oversized inputs", () => {
  assert.throws(
    () => extractDateCandidates("Deadline 2027-01-01", { timeZone: "Not/AZone" }),
    RangeError,
  );
  assert.throws(
    () =>
      extractDateCandidates("x".repeat(1_000_001), {
        timeZone: "UTC",
      }),
    RangeError,
  );
});
