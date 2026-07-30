import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OfficialSourceFetchError, OfficialSourceFetcher } from "./index";
import { PerDomainRateLimiter } from "./rate-limit";

import type { PinnedRequest, RawResponse } from "./request";

const htmlResponse = (status: number, body = "", headers = {}): RawResponse => ({
  body: Buffer.from(body),
  headers: { "content-type": "text/html; charset=utf-8", ...headers },
  status,
});

describe("OfficialSourceFetcher", () => {
  it("pins a vetted public address and respects robots.txt", async () => {
    const calls: Array<{ address: string; url: string }> = [];
    const request: PinnedRequest = async (target, address) => {
      calls.push({ address, url: target.toString() });
      return target.pathname === "/robots.txt"
        ? htmlResponse(200, "User-agent: *\nDisallow: /private")
        : htmlResponse(200, "<main>Admissions</main>");
    };
    const fetcher = new OfficialSourceFetcher(
      { approvedHosts: ["www.example.edu"], minimumIntervalMs: 0 },
      {
        rateLimiter: new PerDomainRateLimiter(0),
        request,
        resolver: async () => ["1.1.1.1"],
      },
    );

    const result = await fetcher.fetch("https://www.example.edu/program");
    assert.equal(result.finalUrl, "https://www.example.edu/program");
    assert.equal(result.contentType, "text/html");
    assert.deepEqual(calls, [
      { address: "1.1.1.1", url: "https://www.example.edu/robots.txt" },
      { address: "1.1.1.1", url: "https://www.example.edu/program" },
    ]);

    await assert.rejects(
      fetcher.fetch("https://www.example.edu/private/report"),
      (error: unknown) =>
        error instanceof OfficialSourceFetchError && error.code === "ROBOTS_DENIED",
    );
    assert.equal(calls.length, 2);
  });

  it("rejects an unapproved redirect before making the redirected request", async () => {
    const calls: string[] = [];
    const request: PinnedRequest = async (target) => {
      calls.push(target.toString());
      if (target.pathname === "/robots.txt") {
        return htmlResponse(404);
      }
      return htmlResponse(302, "", { location: "https://attacker.test/collect" });
    };
    const fetcher = new OfficialSourceFetcher(
      { approvedHosts: ["www.example.edu"], minimumIntervalMs: 0 },
      {
        rateLimiter: new PerDomainRateLimiter(0),
        request,
        resolver: async () => ["8.8.8.8"],
      },
    );

    await assert.rejects(
      fetcher.fetch("https://www.example.edu/program"),
      (error: unknown) =>
        error instanceof OfficialSourceFetchError && error.code === "DOMAIN_NOT_APPROVED",
    );
    assert.equal(calls.length, 2);
  });

  it("rejects an HTTPS downgrade on an otherwise approved host", async () => {
    const request: PinnedRequest = async (target) =>
      target.pathname === "/robots.txt"
        ? htmlResponse(404)
        : htmlResponse(302, "", { location: "http://www.example.edu/program" });
    const fetcher = new OfficialSourceFetcher(
      { approvedHosts: ["www.example.edu"], minimumIntervalMs: 0 },
      {
        rateLimiter: new PerDomainRateLimiter(0),
        request,
        resolver: async () => ["8.8.8.8"],
      },
    );

    await assert.rejects(
      fetcher.fetch("https://www.example.edu/program"),
      (error: unknown) =>
        error instanceof OfficialSourceFetchError && error.code === "INVALID_TARGET",
    );
  });

  it("rejects a private DNS answer before opening a socket", async () => {
    let requestCount = 0;
    const fetcher = new OfficialSourceFetcher(
      { approvedHosts: ["www.example.edu"] },
      {
        request: async () => {
          requestCount += 1;
          return htmlResponse(200);
        },
        resolver: async () => ["169.254.169.254"],
      },
    );

    await assert.rejects(
      fetcher.fetch("https://www.example.edu/program"),
      (error: unknown) =>
        error instanceof OfficialSourceFetchError && error.code === "PRIVATE_TARGET",
    );
    assert.equal(requestCount, 0);
  });
});
