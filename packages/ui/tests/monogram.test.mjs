import assert from "node:assert/strict";
import test from "node:test";

import { getUniversityMonogram } from "../dist/monogram.js";

test("uses the first and last words for a multi-word university", () => {
  assert.equal(getUniversityMonogram("National University of Singapore"), "NS");
});

test("keeps useful Unicode letters", () => {
  assert.equal(getUniversityMonogram("École Polytechnique"), "ÉP");
});

test("uses two characters for a single-word name", () => {
  assert.equal(getUniversityMonogram("KAIST"), "KA");
});

test("returns a neutral fallback for an empty name", () => {
  assert.equal(getUniversityMonogram(" -- "), "U");
});
