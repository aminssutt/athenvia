import { OfficialSourceFetchError } from "./errors";
import type { HostResolver, OfficialDomainPolicy } from "./network-policy";
import type { PerDomainRateLimiter } from "./rate-limit";
import type { RobotsRules } from "./robots";

const HARD_MAXIMUM_HTML_BYTES = 5 * 1024 * 1024;
const HARD_MAXIMUM_MEMORY_MB = 256;
const HARD_MAXIMUM_PAGES = 2;
const HARD_MAXIMUM_REDIRECTS = 10;
const HARD_MAXIMUM_REQUESTS = 200;
const HARD_MAXIMUM_TIMEOUT_MS = 30_000;
const BLOCKED_RESOURCE_TYPES = new Set(["eventsource", "font", "image", "media", "websocket"]);
const HTML_CONTENT_TYPES = new Set(["application/xhtml+xml", "text/html"]);

export type PlaywrightFallbackLimits = {
  maximumHtmlBytes?: number;
  maximumMemoryMb?: number;
  maximumNetworkBytes?: number;
  maximumPages?: number;
  maximumRequests?: number;
  settleTimeoutMs?: number;
  timeoutMs?: number;
};

export type PlaywrightLaunchOptions = {
  hostMappings: ReadonlyMap<string, string>;
  maximumMemoryMb: number;
  timeoutMs: number;
};

export type PlaywrightRequest = {
  frame(): unknown;
  isNavigationRequest(): boolean;
  redirectedFrom(): PlaywrightRequest | null;
  resourceType(): string;
  url(): string;
};

export type PlaywrightRoute = {
  abort(errorCode?: string): Promise<void>;
  continue(): Promise<void>;
  request(): PlaywrightRequest;
};

export type PlaywrightResponse = {
  headers(): Record<string, string>;
  status(): number;
};

export type PlaywrightPage = {
  close(): Promise<void>;
  content(): Promise<string>;
  goto(
    url: string,
    options: { timeout: number; waitUntil: "domcontentloaded" },
  ): Promise<PlaywrightResponse | null>;
  mainFrame(): unknown;
  on(event: "response", listener: (response: PlaywrightResponse) => void): void;
  setDefaultNavigationTimeout(timeout: number): void;
  setDefaultTimeout(timeout: number): void;
  url(): string;
  waitForLoadState(state: "networkidle", options: { timeout: number }): Promise<void>;
};

export type PlaywrightBrowserContext = {
  close(): Promise<void>;
  newCDPSession(page: PlaywrightPage): Promise<PlaywrightCdpSession>;
  newPage(): Promise<PlaywrightPage>;
  on(event: "page", listener: (page: PlaywrightPage) => void): void;
  route(pattern: string, handler: (route: PlaywrightRoute) => Promise<void>): Promise<void>;
};

export type PlaywrightCdpSession = {
  detach(): Promise<void>;
  on(
    event: "Network.dataReceived",
    listener: (payload: { encodedDataLength: number }) => void,
  ): void;
  send(method: "Network.enable"): Promise<unknown>;
};

export type PlaywrightBrowser = {
  close(): Promise<void>;
  newContext(options: {
    acceptDownloads: false;
    ignoreHTTPSErrors: false;
    javaScriptEnabled: true;
    serviceWorkers: "block";
    userAgent: string;
  }): Promise<PlaywrightBrowserContext>;
};

export type PlaywrightBrowserLauncher = (
  options: PlaywrightLaunchOptions,
) => Promise<PlaywrightBrowser>;

type ChromiumBrowserType = {
  launch(options: {
    args: string[];
    chromiumSandbox: true;
    headless: true;
    timeout: number;
  }): Promise<PlaywrightBrowser>;
};

type PlaywrightModule = {
  chromium?: ChromiumBrowserType;
};

export type PlaywrightFetchDependencies = {
  browserLauncher: PlaywrightBrowserLauncher;
  domainPolicy: OfficialDomainPolicy;
  fetchRobots: (target: URL) => Promise<RobotsRules>;
  rateLimiter: PerDomainRateLimiter;
  resolver: HostResolver;
  userAgent: string;
};

export type PlaywrightFetchResult = {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  status: number;
};

type NormalizedLimits = {
  maximumHtmlBytes: number;
  maximumMemoryMb: number;
  maximumNetworkBytes: number;
  maximumPages: number;
  maximumRedirects: number;
  maximumRequests: number;
  settleTimeoutMs: number;
  timeoutMs: number;
};

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new OfficialSourceFetchError(
      "BROWSER_LIMIT",
      "Playwright resource limits must be positive integers.",
    );
  }
  return Math.min(value, maximum);
}

function boundedNonNegativeInteger(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new OfficialSourceFetchError(
      "BROWSER_LIMIT",
      "The Playwright redirect limit must be a non-negative integer.",
    );
  }
  return Math.min(value, maximum);
}

function normalizedLimits(
  limits: PlaywrightFallbackLimits,
  maximumRedirects: number,
): NormalizedLimits {
  const maximumHtmlBytes = boundedInteger(
    limits.maximumHtmlBytes,
    2 * 1024 * 1024,
    HARD_MAXIMUM_HTML_BYTES,
  );

  return {
    maximumHtmlBytes,
    maximumMemoryMb: boundedInteger(limits.maximumMemoryMb, 128, HARD_MAXIMUM_MEMORY_MB),
    maximumNetworkBytes: boundedInteger(
      limits.maximumNetworkBytes,
      10 * 1024 * 1024,
      20 * 1024 * 1024,
    ),
    maximumPages: boundedInteger(limits.maximumPages, 1, HARD_MAXIMUM_PAGES),
    maximumRedirects: boundedNonNegativeInteger(maximumRedirects, HARD_MAXIMUM_REDIRECTS),
    maximumRequests: boundedInteger(limits.maximumRequests, 60, HARD_MAXIMUM_REQUESTS),
    settleTimeoutMs: boundedInteger(limits.settleTimeoutMs, 1_500, 5_000),
    timeoutMs: boundedInteger(limits.timeoutMs, 12_000, HARD_MAXIMUM_TIMEOUT_MS),
  };
}

function errorFromUnknown(error: unknown): OfficialSourceFetchError {
  return error instanceof OfficialSourceFetchError
    ? error
    : new OfficialSourceFetchError(
        "BROWSER_UNAVAILABLE",
        "The Playwright fallback could not retrieve this source.",
      );
}

async function safeClose(resource: { close(): Promise<void> } | null): Promise<void> {
  if (!resource) {
    return;
  }
  try {
    await resource.close();
  } catch {
    // Cleanup remains best-effort so the original retrieval error is preserved.
  }
}

async function safeDetach(session: PlaywrightCdpSession | null): Promise<void> {
  if (!session) {
    return;
  }
  try {
    await session.detach();
  } catch {
    // Cleanup remains best-effort so the original retrieval error is preserved.
  }
}

function hostResolverRules(hostMappings: ReadonlyMap<string, string>): string {
  const rules = [...hostMappings].map(([hostname, address]) => {
    const destination = address.includes(":") ? `[${address}]` : address;
    return `MAP ${hostname} ${destination}`;
  });
  rules.push("MAP * ~NOTFOUND");
  return rules.join(", ");
}

export const systemPlaywrightBrowserLauncher: PlaywrightBrowserLauncher = async (options) => {
  const moduleName = "playwright";
  let playwright: PlaywrightModule;

  try {
    playwright = (await import(moduleName)) as PlaywrightModule;
  } catch {
    throw new OfficialSourceFetchError(
      "BROWSER_UNAVAILABLE",
      "Playwright is not installed in the worker runtime.",
    );
  }

  if (!playwright.chromium) {
    throw new OfficialSourceFetchError(
      "BROWSER_UNAVAILABLE",
      "The Playwright Chromium engine is unavailable.",
    );
  }

  return playwright.chromium.launch({
    args: [
      `--host-resolver-rules=${hostResolverRules(options.hostMappings)}`,
      `--js-flags=--max-old-space-size=${options.maximumMemoryMb}`,
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-dev-shm-usage",
      "--disable-extensions",
      "--disable-quic",
      "--disable-sync",
      "--disable-blink-features=WebRTC",
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      "--metrics-recording-only",
      "--no-first-run",
      "--renderer-process-limit=1",
    ],
    chromiumSandbox: true,
    headless: true,
    timeout: options.timeoutMs,
  });
};

async function pinnedApprovedHosts(
  policy: OfficialDomainPolicy,
  resolver: HostResolver,
): Promise<Map<string, string>> {
  const mappings = new Map<string, string>();

  await Promise.all(
    policy.approvedHostnames().map(async (hostname) => {
      const target = policy.parseTarget(`https://${hostname}/`);
      const addresses = await policy.resolvePublicTarget(target, resolver);
      const address = addresses.find((candidate) => !candidate.includes(":")) ?? addresses[0];
      if (!address) {
        throw new OfficialSourceFetchError(
          "PRIVATE_TARGET",
          "No public target address was found for Playwright.",
        );
      }
      mappings.set(hostname, address);
    }),
  );

  return mappings;
}

function responseContentType(response: PlaywrightResponse): string {
  return (response.headers()["content-type"] ?? "application/octet-stream")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
}

function assertNoHttpsDowngrade(request: PlaywrightRequest, target: URL): void {
  const previous = request.redirectedFrom();
  if (!previous) {
    return;
  }

  const previousTarget = new URL(previous.url());
  if (previousTarget.protocol === "https:" && target.protocol !== "https:") {
    throw new OfficialSourceFetchError(
      "INVALID_TARGET",
      "An HTTPS official source cannot redirect to plaintext HTTP.",
    );
  }
}

export async function fetchWithPlaywright(
  target: URL,
  dependencies: PlaywrightFetchDependencies,
  limits: PlaywrightFallbackLimits,
  maximumRedirects: number,
): Promise<PlaywrightFetchResult> {
  const bounded = normalizedLimits(limits, maximumRedirects);
  const hostMappings = await pinnedApprovedHosts(dependencies.domainPolicy, dependencies.resolver);
  let browser: PlaywrightBrowser | null = null;
  let context: PlaywrightBrowserContext | null = null;
  let page: PlaywrightPage | null = null;
  let cdpSession: PlaywrightCdpSession | null = null;
  let deadline: NodeJS.Timeout | undefined;
  let timedOut = false;

  try {
    const operation = async (): Promise<PlaywrightFetchResult> => {
      browser = await dependencies.browserLauncher({
        hostMappings,
        maximumMemoryMb: bounded.maximumMemoryMb,
        timeoutMs: bounded.timeoutMs,
      });
      if (timedOut) {
        await safeClose(browser);
        throw new OfficialSourceFetchError("TIMEOUT", "Playwright retrieval timed out.");
      }
      context = await browser.newContext({
        acceptDownloads: false,
        ignoreHTTPSErrors: false,
        javaScriptEnabled: true,
        serviceWorkers: "block",
        userAgent: dependencies.userAgent,
      });
      if (timedOut) {
        await safeClose(context);
        await safeClose(browser);
        throw new OfficialSourceFetchError("TIMEOUT", "Playwright retrieval timed out.");
      }

      let openedPages = 0;
      let requestCount = 0;
      let redirectCount = 0;
      let receivedNetworkBytes = 0;
      let interceptionError: OfficialSourceFetchError | null = null;

      context.on("page", (openedPage) => {
        openedPages += 1;
        if (openedPages > bounded.maximumPages) {
          interceptionError ??= new OfficialSourceFetchError(
            "BROWSER_LIMIT",
            "The Playwright page limit was exceeded.",
            { maximumPages: bounded.maximumPages },
          );
          void safeClose(openedPage);
        }
      });

      await context.route("**/*", async (route) => {
        const request = route.request();
        requestCount += 1;

        try {
          if (requestCount > bounded.maximumRequests) {
            throw new OfficialSourceFetchError(
              "BROWSER_LIMIT",
              "The Playwright request limit was exceeded.",
              { maximumRequests: bounded.maximumRequests },
            );
          }

          if (BLOCKED_RESOURCE_TYPES.has(request.resourceType())) {
            await route.abort("blockedbyclient");
            return;
          }

          const requestTarget = dependencies.domainPolicy.parseTarget(request.url());
          await dependencies.domainPolicy.resolvePublicTarget(requestTarget, dependencies.resolver);

          if (request.isNavigationRequest()) {
            if (page && request.frame() !== page.mainFrame()) {
              await route.abort("blockedbyclient");
              return;
            }

            assertNoHttpsDowngrade(request, requestTarget);
            if (request.redirectedFrom()) {
              redirectCount += 1;
              if (redirectCount > bounded.maximumRedirects) {
                throw new OfficialSourceFetchError(
                  "REDIRECT_LIMIT",
                  "Official source exceeded the redirect limit.",
                );
              }
            }

            const robots = await dependencies.fetchRobots(requestTarget);
            if (!robots.allowed(`${requestTarget.pathname}${requestTarget.search}`)) {
              throw new OfficialSourceFetchError(
                "ROBOTS_DENIED",
                "Official source path is disallowed by robots.txt.",
                { hostname: requestTarget.hostname },
              );
            }

            await dependencies.rateLimiter.schedule(
              requestTarget.hostname,
              robots.crawlDelayMs,
              () => route.continue(),
            );
            return;
          }

          await route.continue();
        } catch (error) {
          const fetchError = errorFromUnknown(error);
          if (request.isNavigationRequest() || fetchError.code === "BROWSER_LIMIT") {
            interceptionError ??= fetchError;
          }
          await route.abort("blockedbyclient").catch(() => {});
        }
      });

      page = await context.newPage();
      page.setDefaultNavigationTimeout(bounded.timeoutMs);
      page.setDefaultTimeout(bounded.timeoutMs);
      cdpSession = await context.newCDPSession(page);
      await cdpSession.send("Network.enable");
      cdpSession.on("Network.dataReceived", ({ encodedDataLength }) => {
        if (Number.isFinite(encodedDataLength) && encodedDataLength > 0) {
          receivedNetworkBytes += encodedDataLength;
        }
        if (receivedNetworkBytes > bounded.maximumNetworkBytes) {
          interceptionError ??= new OfficialSourceFetchError(
            "BROWSER_LIMIT",
            "The Playwright network-byte limit was exceeded.",
            { maximumNetworkBytes: bounded.maximumNetworkBytes },
          );
          void safeClose(page);
        }
      });

      let response: PlaywrightResponse | null;
      try {
        response = await page.goto(target.toString(), {
          timeout: bounded.timeoutMs,
          waitUntil: "domcontentloaded",
        });
      } catch (error) {
        throw interceptionError ?? errorFromUnknown(error);
      }
      if (interceptionError) {
        throw interceptionError;
      }
      if (!response) {
        throw new OfficialSourceFetchError(
          "HTTP_ERROR",
          "The Playwright navigation returned no response.",
        );
      }

      try {
        await page.waitForLoadState("networkidle", { timeout: bounded.settleTimeoutMs });
      } catch {
        if (interceptionError) {
          throw interceptionError;
        }
        // A bounded network-idle wait is opportunistic; dynamic pages may keep polling.
      }

      if (interceptionError) {
        throw interceptionError;
      }

      const status = response.status();
      if (status < 200 || status >= 300) {
        throw new OfficialSourceFetchError(
          "HTTP_ERROR",
          "Official source returned a non-success response.",
          { status },
        );
      }

      const contentType = responseContentType(response);
      if (!HTML_CONTENT_TYPES.has(contentType)) {
        throw new OfficialSourceFetchError(
          "UNSUPPORTED_CONTENT_TYPE",
          "Playwright fallback only accepts HTML responses.",
          { contentType },
        );
      }

      const finalTarget = dependencies.domainPolicy.parseTarget(page.url());
      const html = Buffer.from(await page.content(), "utf8");
      if (html.byteLength > bounded.maximumHtmlBytes) {
        throw new OfficialSourceFetchError(
          "RESPONSE_TOO_LARGE",
          "Rendered HTML exceeded the response-size limit.",
          { maximumBytes: bounded.maximumHtmlBytes },
        );
      }

      return {
        body: html,
        contentType,
        finalUrl: finalTarget.toString(),
        status,
      };
    };

    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => {
          timedOut = true;
          reject(
            new OfficialSourceFetchError("TIMEOUT", "Playwright retrieval timed out.", {
              timeoutMs: bounded.timeoutMs,
            }),
          );
        }, bounded.timeoutMs);
      }),
    ]);
  } catch (error) {
    throw errorFromUnknown(error);
  } finally {
    if (deadline) {
      clearTimeout(deadline);
    }
    await safeDetach(cdpSession);
    await safeClose(page);
    await safeClose(context);
    await safeClose(browser);
  }
}
