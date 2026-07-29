import assert from "node:assert/strict";
import test from "node:test";

import { interfaceStateCopy } from "../dist/interface-state-copy.js";

test("provides a complete default message for every interface state", () => {
  assert.deepEqual(Object.keys(interfaceStateCopy), ["loading", "empty", "error"]);

  for (const state of Object.values(interfaceStateCopy)) {
    assert.ok(state.title.length > 0);
    assert.ok(state.description.length > 0);
  }

  assert.equal(interfaceStateCopy.error.retryLabel, "Try again");
});

test("default messages do not expose implementation terms", () => {
  const publicCopy = JSON.stringify(interfaceStateCopy);
  const implementationTerms =
    /\b(API|HTTP|server|worker|scraping|extraction|confidence|exception)\b/i;

  assert.doesNotMatch(publicCopy, implementationTerms);
});
