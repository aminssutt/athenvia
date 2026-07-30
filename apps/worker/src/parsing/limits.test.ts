import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SAFE_TEXT_LIMITS } from "./index";
import { resolveLimits } from "./limits";

test("allows callers to lower but never raise process safety ceilings", () => {
  const limits = resolveLimits({ maximumPdfBytes: 1_024 });
  assert.equal(limits.maximumPdfBytes, 1_024);

  assert.throws(
    () =>
      resolveLimits({
        maximumPdfBytes: DEFAULT_SAFE_TEXT_LIMITS.maximumPdfBytes + 1,
      }),
    RangeError,
  );
});

test("rejects invalid and unknown limit configuration", () => {
  assert.throws(() => resolveLimits({ maximumHtmlTags: 0 }), TypeError);
  assert.throws(() => resolveLimits({ unexpectedLimit: 1 } as never), /Unknown safe-text limit/u);
});
