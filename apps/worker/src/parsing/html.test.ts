import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { extractSafeText, SafeTextExtractionError } from "./index";

const fixtureUrl = new URL("./fixtures/admissions.html", import.meta.url);

test("extracts structured HTML text without executing or retaining active content", async () => {
  const fixture = await readFile(fixtureUrl);
  delete (globalThis as Record<string, unknown>).__unsafeAdmissionsScriptRan;

  const first = extractSafeText({ body: fixture, contentType: "text/html; charset=utf-8" });
  const second = extractSafeText({ body: fixture, contentType: "text/html; charset=utf-8" });

  assert.deepEqual(first, second);
  assert.equal(first.format, "html");
  assert.match(first.text, /Graduate Admissions 2027/u);
  assert.match(first.text, /Applications & supporting documents/u);
  assert.match(first.text, /Application deadline: 15 January 2027\./u);
  assert.match(first.text, /- Official transcript/u);
  assert.match(first.text, /- Two references/u);
  assert.doesNotMatch(first.text, /Fake|Ignore|javascript|globalThis/u);
  assert.equal((globalThis as Record<string, unknown>).__unsafeAdmissionsScriptRan, undefined);
  assert.ok((first.stats.htmlTagsVisited ?? 0) > 0);
});

test("discards hidden and embedded HTML subtrees while keeping visible siblings", () => {
  const result = extractSafeText({
    body: `
      <main>
        <p>Visible first</p>
        <div aria-hidden="true"><p>Invisible aria content</p></div>
        <div style="display: none">Invisible style content</div>
        <svg><text>Invisible vector content</text></svg>
        <p>Visible last &#x1F393;</p>
      </main>
    `,
    contentType: "application/xhtml+xml",
  });

  assert.equal(result.text, "Visible first\nVisible last 🎓");
});

test("decodes canonical named entities without mojibake", () => {
  const result = extractSafeText({
    body: "<p>&copy; &euro; &ldquo;Admissions&rdquo; &mdash; 2027</p>",
    contentType: "text/html",
  });

  assert.equal(result.text, "© € “Admissions” — 2027");
});

test("enforces deterministic HTML resource budgets", () => {
  assert.throws(
    () =>
      extractSafeText(
        { body: "<p>too large</p>", contentType: "text/html" },
        { limits: { maximumHtmlBytes: 5 } },
      ),
    (error) =>
      error instanceof SafeTextExtractionError &&
      error.code === "INPUT_TOO_LARGE" &&
      error.retryable === false,
  );

  assert.throws(
    () =>
      extractSafeText(
        { body: "<div><span>nested</span></div>", contentType: "text/html" },
        { limits: { maximumNestingDepth: 1 } },
      ),
    (error) => error instanceof SafeTextExtractionError && error.code === "HTML_LIMIT_EXCEEDED",
  );
});
