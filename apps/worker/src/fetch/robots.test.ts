import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseRobots } from "./robots";

describe("robots policy", () => {
  it("uses the Athenvia-specific group over the wildcard group", () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow: /

      User-agent: AthenviaBot
      Disallow: /private
      Allow: /private/public
      Crawl-delay: 2
    `);

    assert.equal(rules.allowed("/programs"), true);
    assert.equal(rules.allowed("/private/report"), false);
    assert.equal(rules.allowed("/private/public/report"), true);
    assert.equal(rules.crawlDelayMs, 2_000);
  });

  it("allows crawling when no applicable rules exist", () => {
    const rules = parseRobots("User-agent: OtherBot\nDisallow: /");
    assert.equal(rules.allowed("/program"), true);
    assert.equal(rules.crawlDelayMs, null);
  });

  it("caps unreasonable crawl delays", () => {
    assert.equal(parseRobots("User-agent: *\nCrawl-delay: 900").crawlDelayMs, 60_000);
  });

  it("applies wildcard and end-anchored path rules", () => {
    const rules = parseRobots(`
      User-agent: *
      Disallow: /*?preview=
      Disallow: /*.pdf$
      Allow: /public/*.pdf$
    `);

    assert.equal(rules.allowed("/program?preview=true"), false);
    assert.equal(rules.allowed("/private/guide.pdf"), false);
    assert.equal(rules.allowed("/private/guide.pdf?download=1"), true);
    assert.equal(rules.allowed("/public/guide.pdf"), true);
  });
});
