import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { OfficialSourceFetchError } from "./errors";
import { OfficialDomainPolicy } from "./network-policy";
import {
  fetchWithPlaywright,
  type PlaywrightBrowserLauncher,
  type PlaywrightLaunchOptions,
  type PlaywrightPage,
  type PlaywrightRequest,
  type PlaywrightResponse,
  type PlaywrightRoute,
} from "./playwright";
import { PerDomainRateLimiter } from "./rate-limit";
import type { RobotsRules } from "./robots";

type RequestSpec = {
  frame?: "main" | "child";
  navigation?: boolean;
  redirectedFrom?: RequestSpec;
  resourceType?: string;
  url: string;
};

type BrowserScenario = {
  finalUrl?: string;
  html?: string;
  networkBytes?: number[];
  neverFinishes?: boolean;
  popupCount?: number;
  requests?: RequestSpec[];
  responseHeaders?: Record<string, string>;
  status?: number;
};

type Harness = {
  aborted: string[];
  browserCloseCount: number;
  contextCloseCount: number;
  continued: string[];
  launchOptions: PlaywrightLaunchOptions[];
  launcher: PlaywrightBrowserLauncher;
  pageCloseCount: number;
  popupCloseCount: number;
};

function browserHarness(scenario: BrowserScenario): Harness {
  const harness: Harness = {
    aborted: [],
    browserCloseCount: 0,
    contextCloseCount: 0,
    continued: [],
    launchOptions: [],
    launcher: async () => {
      throw new Error("launcher not initialized");
    },
    pageCloseCount: 0,
    popupCloseCount: 0,
  };

  harness.launcher = async (launchOptions) => {
    harness.launchOptions.push(launchOptions);
    let routeHandler: ((route: PlaywrightRoute) => Promise<void>) | null = null;
    let pageListener: ((page: PlaywrightPage) => void) | null = null;
    const mainFrame = {};
    const responseListeners: Array<(response: PlaywrightResponse) => void> = [];
    let dataListener: ((payload: { encodedDataLength: number }) => void) | null = null;
    const response: PlaywrightResponse = {
      headers: () => ({
        "content-type": "text/html; charset=utf-8",
        ...scenario.responseHeaders,
      }),
      status: () => scenario.status ?? 200,
    };

    const makeRequest = (
      spec: RequestSpec,
      previous: PlaywrightRequest | null = null,
    ): PlaywrightRequest => {
      const redirectedFrom = spec.redirectedFrom
        ? makeRequest(spec.redirectedFrom, previous)
        : previous;
      return {
        frame: () => (spec.frame === "child" ? {} : mainFrame),
        isNavigationRequest: () => spec.navigation ?? false,
        redirectedFrom: () => redirectedFrom,
        resourceType: () => spec.resourceType ?? "script",
        url: () => spec.url,
      };
    };

    const popupPage = {
      close: async () => {
        harness.popupCloseCount += 1;
      },
    } as PlaywrightPage;

    const page: PlaywrightPage = {
      close: async () => {
        harness.pageCloseCount += 1;
      },
      content: async () => scenario.html ?? "<html><main>Rendered admissions</main></html>",
      goto: async () => {
        if (scenario.neverFinishes) {
          return new Promise<never>(() => {});
        }

        for (const spec of scenario.requests ?? [
          {
            navigation: true,
            resourceType: "document",
            url: "https://www.example.edu/program",
          },
        ]) {
          assert.ok(routeHandler);
          const request = makeRequest(spec);
          let action: "aborted" | "continued" | null = null;
          await routeHandler({
            abort: async () => {
              action = "aborted";
              harness.aborted.push(spec.url);
            },
            continue: async () => {
              action = "continued";
              harness.continued.push(spec.url);
            },
            request: () => request,
          });
          if (action === "aborted" && request.isNavigationRequest()) {
            throw new Error("navigation aborted");
          }
        }

        for (let index = 0; index < (scenario.popupCount ?? 0); index += 1) {
          pageListener?.(popupPage);
        }
        for (const listener of responseListeners) {
          listener(response);
        }
        for (const encodedDataLength of scenario.networkBytes ?? []) {
          dataListener?.({ encodedDataLength });
        }
        return response;
      },
      mainFrame: () => mainFrame,
      on: (_event, listener) => {
        responseListeners.push(listener);
      },
      setDefaultNavigationTimeout: () => {},
      setDefaultTimeout: () => {},
      url: () => scenario.finalUrl ?? "https://www.example.edu/program",
      waitForLoadState: async () => {},
    };

    return {
      close: async () => {
        harness.browserCloseCount += 1;
      },
      newContext: async () => ({
        close: async () => {
          harness.contextCloseCount += 1;
        },
        newCDPSession: async () => ({
          detach: async () => {},
          on: (_event, listener) => {
            dataListener = listener;
          },
          send: async () => ({}),
        }),
        newPage: async () => {
          pageListener?.(page);
          return page;
        },
        on: (_event, listener) => {
          pageListener = listener;
        },
        route: async (_pattern, handler) => {
          routeHandler = handler;
        },
      }),
    };
  };

  return harness;
}

function dependencies(
  launcher: PlaywrightBrowserLauncher,
  overrides: {
    fetchRobots?: (target: URL) => Promise<RobotsRules>;
    resolver?: (hostname: string) => Promise<string[]>;
  } = {},
) {
  return {
    browserLauncher: launcher,
    domainPolicy: new OfficialDomainPolicy(["www.example.edu", "static.example.edu"]),
    fetchRobots:
      overrides.fetchRobots ??
      (async () => ({
        allowed: () => true,
        crawlDelayMs: null,
      })),
    rateLimiter: new PerDomainRateLimiter(0),
    resolver: overrides.resolver ?? (async () => ["1.1.1.1"]),
    userAgent: "AthenviaBot/0.1",
  };
}

function hasCode(code: OfficialSourceFetchError["code"]) {
  return (error: unknown) => error instanceof OfficialSourceFetchError && error.code === code;
}

describe("Playwright official-source fallback", () => {
  it("pins approved hosts and blocks unapproved or unnecessary subresources", async () => {
    const harness = browserHarness({
      requests: [
        {
          navigation: true,
          resourceType: "document",
          url: "https://www.example.edu/program",
        },
        {
          resourceType: "script",
          url: "https://static.example.edu/app.js",
        },
        {
          resourceType: "script",
          url: "https://tracker.attacker.test/collect.js",
        },
        {
          resourceType: "image",
          url: "https://tracker.attacker.test/pixel.gif",
        },
      ],
    });

    const result = await fetchWithPlaywright(
      new URL("https://www.example.edu/program"),
      dependencies(harness.launcher),
      { maximumMemoryMb: 10_000 },
      3,
    );

    assert.match(result.body.toString(), /Rendered admissions/u);
    assert.deepEqual(harness.continued, [
      "https://www.example.edu/program",
      "https://static.example.edu/app.js",
    ]);
    assert.deepEqual(harness.aborted, [
      "https://tracker.attacker.test/collect.js",
      "https://tracker.attacker.test/pixel.gif",
    ]);
    assert.equal(harness.launchOptions[0]?.maximumMemoryMb, 256);
    assert.deepEqual([...(harness.launchOptions[0]?.hostMappings ?? new Map()).keys()].sort(), [
      "static.example.edu",
      "www.example.edu",
    ]);
    assert.equal(harness.contextCloseCount, 1);
    assert.equal(harness.browserCloseCount, 1);
  });

  it("fails a navigation redirect before contacting an unapproved host", async () => {
    const firstRequest: RequestSpec = {
      navigation: true,
      resourceType: "document",
      url: "https://www.example.edu/program",
    };
    const harness = browserHarness({
      requests: [
        firstRequest,
        {
          navigation: true,
          redirectedFrom: firstRequest,
          resourceType: "document",
          url: "https://attacker.test/collect",
        },
      ],
    });

    await assert.rejects(
      fetchWithPlaywright(
        new URL("https://www.example.edu/program"),
        dependencies(harness.launcher),
        {},
        3,
      ),
      hasCode("DOMAIN_NOT_APPROVED"),
    );
    assert.deepEqual(harness.continued, ["https://www.example.edu/program"]);
    assert.deepEqual(harness.aborted, ["https://attacker.test/collect"]);
    assert.equal(harness.contextCloseCount, 1);
    assert.equal(harness.browserCloseCount, 1);
  });

  it("rejects HTTPS downgrade redirects and enforces the shared redirect cap", async (context) => {
    const initial: RequestSpec = {
      navigation: true,
      resourceType: "document",
      url: "https://www.example.edu/program",
    };

    await context.test("HTTPS downgrade", async () => {
      const harness = browserHarness({
        requests: [
          initial,
          {
            navigation: true,
            redirectedFrom: initial,
            resourceType: "document",
            url: "http://www.example.edu/program",
          },
        ],
      });
      await assert.rejects(
        fetchWithPlaywright(new URL(initial.url), dependencies(harness.launcher), {}, 3),
        hasCode("INVALID_TARGET"),
      );
      assert.deepEqual(harness.aborted, ["http://www.example.edu/program"]);
    });

    await context.test("redirect cap", async () => {
      const second: RequestSpec = {
        navigation: true,
        redirectedFrom: initial,
        resourceType: "document",
        url: "https://static.example.edu/step-one",
      };
      const harness = browserHarness({
        requests: [
          initial,
          second,
          {
            navigation: true,
            redirectedFrom: second,
            resourceType: "document",
            url: "https://www.example.edu/step-two",
          },
        ],
      });
      await assert.rejects(
        fetchWithPlaywright(new URL(initial.url), dependencies(harness.launcher), {}, 1),
        hasCode("REDIRECT_LIMIT"),
      );
      assert.deepEqual(harness.aborted, ["https://www.example.edu/step-two"]);
    });
  });

  it("revalidates DNS and fails closed on a rebinding answer", async () => {
    const harness = browserHarness({});
    let resolutionCount = 0;

    await assert.rejects(
      fetchWithPlaywright(
        new URL("https://www.example.edu/program"),
        dependencies(harness.launcher, {
          resolver: async () => {
            resolutionCount += 1;
            return resolutionCount <= 2 ? ["1.1.1.1"] : ["169.254.169.254"];
          },
        }),
        {},
        3,
      ),
      hasCode("PRIVATE_TARGET"),
    );
    assert.equal(harness.continued.length, 0);
    assert.equal(harness.browserCloseCount, 1);
  });

  it("enforces request, page, and rendered-output limits", async (context) => {
    await context.test("request count", async () => {
      const harness = browserHarness({
        requests: [
          {
            navigation: true,
            resourceType: "document",
            url: "https://www.example.edu/program",
          },
          { url: "https://static.example.edu/one.js" },
          { url: "https://static.example.edu/two.js" },
        ],
      });
      await assert.rejects(
        fetchWithPlaywright(
          new URL("https://www.example.edu/program"),
          dependencies(harness.launcher),
          { maximumRequests: 2 },
          3,
        ),
        hasCode("BROWSER_LIMIT"),
      );
      assert.deepEqual(harness.aborted, ["https://static.example.edu/two.js"]);
    });

    await context.test("page count", async () => {
      const harness = browserHarness({ popupCount: 1 });
      await assert.rejects(
        fetchWithPlaywright(
          new URL("https://www.example.edu/program"),
          dependencies(harness.launcher),
          { maximumPages: 1 },
          3,
        ),
        hasCode("BROWSER_LIMIT"),
      );
      assert.equal(harness.popupCloseCount, 1);
    });

    await context.test("rendered HTML bytes", async () => {
      const harness = browserHarness({ html: `<main>${"x".repeat(128)}</main>` });
      await assert.rejects(
        fetchWithPlaywright(
          new URL("https://www.example.edu/program"),
          dependencies(harness.launcher),
          { maximumHtmlBytes: 64 },
          3,
        ),
        hasCode("RESPONSE_TOO_LARGE"),
      );
    });

    await context.test("chunked network bytes", async () => {
      const harness = browserHarness({ networkBytes: [40, 40] });
      await assert.rejects(
        fetchWithPlaywright(
          new URL("https://www.example.edu/program"),
          dependencies(harness.launcher),
          { maximumNetworkBytes: 64 },
          3,
        ),
        hasCode("BROWSER_LIMIT"),
      );
    });
  });

  it("closes the page, context, and browser on the global deadline", async () => {
    const harness = browserHarness({ neverFinishes: true });

    await assert.rejects(
      fetchWithPlaywright(
        new URL("https://www.example.edu/program"),
        dependencies(harness.launcher),
        { timeoutMs: 10 },
        3,
      ),
      hasCode("TIMEOUT"),
    );
    assert.equal(harness.pageCloseCount, 1);
    assert.equal(harness.contextCloseCount, 1);
    assert.equal(harness.browserCloseCount, 1);
  });

  it("applies robots policy to every browser navigation", async () => {
    const firstRequest: RequestSpec = {
      navigation: true,
      resourceType: "document",
      url: "https://www.example.edu/program",
    };
    const harness = browserHarness({
      requests: [
        firstRequest,
        {
          navigation: true,
          redirectedFrom: firstRequest,
          resourceType: "document",
          url: "https://static.example.edu/blocked",
        },
      ],
    });

    await assert.rejects(
      fetchWithPlaywright(
        new URL("https://www.example.edu/program"),
        dependencies(harness.launcher, {
          fetchRobots: async (target) => ({
            allowed: () => target.pathname !== "/blocked",
            crawlDelayMs: null,
          }),
        }),
        {},
        3,
      ),
      hasCode("ROBOTS_DENIED"),
    );
    assert.deepEqual(harness.aborted, ["https://static.example.edu/blocked"]);
  });
});
