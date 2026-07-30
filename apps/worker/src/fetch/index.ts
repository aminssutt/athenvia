import { OfficialSourceFetchError } from "./errors";
import { type HostResolver, OfficialDomainPolicy, systemHostResolver } from "./network-policy";
import {
  fetchWithPlaywright,
  type PlaywrightBrowserLauncher,
  type PlaywrightFallbackLimits,
  systemPlaywrightBrowserLauncher,
} from "./playwright";
import { PerDomainRateLimiter } from "./rate-limit";
import { type PinnedRequest, pinnedRequest, type RawResponse } from "./request";
import { parseRobots, type RobotsRules } from "./robots";

const DEFAULT_USER_AGENT = "AthenviaBot/0.1 (+https://athenvia.com/bot)";
const ROBOTS_CACHE_MS = 15 * 60 * 1_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "application/xhtml+xml",
  "text/html",
  "text/plain",
];
const BROWSER_CONTENT_TYPES = new Set(["application/xhtml+xml", "text/html"]);

export type OfficialSourceFetchResult = {
  body: Buffer;
  contentType: string;
  finalUrl: string;
  status: number;
};

export type OfficialSourceFetcherOptions = {
  approvedHosts: readonly string[];
  playwrightFallback?: PlaywrightFallbackLimits & {
    shouldFallback(result: OfficialSourceFetchResult): boolean;
  };
  maximumBytes?: number;
  maximumRedirects?: number;
  minimumIntervalMs?: number;
  timeoutMs?: number;
  userAgent?: string;
};

type FetcherDependencies = {
  browserLauncher?: PlaywrightBrowserLauncher;
  now?: () => number;
  rateLimiter?: PerDomainRateLimiter;
  request?: PinnedRequest;
  resolver?: HostResolver;
};

type CachedRobots = {
  expiresAt: number;
  rules: RobotsRules;
};

function headerValue(response: RawResponse, name: string): string | null {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function responseContentType(response: RawResponse): string {
  return (headerValue(response, "content-type") ?? "application/octet-stream")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();
}

function redirectTarget(
  location: string,
  currentTarget: URL,
  domainPolicy: OfficialDomainPolicy,
): URL {
  const nextTarget = domainPolicy.parseTarget(new URL(location, currentTarget));
  if (currentTarget.protocol === "https:" && nextTarget.protocol !== "https:") {
    throw new OfficialSourceFetchError(
      "INVALID_TARGET",
      "An HTTPS official source cannot redirect to plaintext HTTP.",
    );
  }
  return nextTarget;
}

export class OfficialSourceFetcher {
  private readonly browserLauncher: PlaywrightBrowserLauncher;
  private readonly domainPolicy: OfficialDomainPolicy;
  private readonly maximumBytes: number;
  private readonly maximumRedirects: number;
  private readonly now: () => number;
  private readonly playwrightFallback: OfficialSourceFetcherOptions["playwrightFallback"];
  private readonly rateLimiter: PerDomainRateLimiter;
  private readonly request: PinnedRequest;
  private readonly resolver: HostResolver;
  private readonly robotsCache = new Map<string, CachedRobots>();
  private readonly timeoutMs: number;
  private readonly userAgent: string;

  constructor(options: OfficialSourceFetcherOptions, dependencies: FetcherDependencies = {}) {
    this.browserLauncher = dependencies.browserLauncher ?? systemPlaywrightBrowserLauncher;
    this.domainPolicy = new OfficialDomainPolicy(options.approvedHosts);
    this.maximumBytes = options.maximumBytes ?? 5 * 1024 * 1024;
    this.maximumRedirects = options.maximumRedirects ?? 3;
    this.now = dependencies.now ?? Date.now;
    this.playwrightFallback = options.playwrightFallback;
    this.rateLimiter =
      dependencies.rateLimiter ??
      new PerDomainRateLimiter(options.minimumIntervalMs ?? 1_000, this.now);
    this.request = dependencies.request ?? pinnedRequest;
    this.resolver = dependencies.resolver ?? systemHostResolver;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
  }

  private async requestOnce(target: URL, crawlDelayMs: number | null): Promise<RawResponse> {
    const addresses = await this.domainPolicy.resolvePublicTarget(target, this.resolver);
    const address = addresses[0];
    if (!address) {
      throw new OfficialSourceFetchError("PRIVATE_TARGET", "No public target address was found.");
    }

    return this.rateLimiter.schedule(target.hostname, crawlDelayMs, () =>
      this.request(target, address, {
        maximumBytes: this.maximumBytes,
        timeoutMs: this.timeoutMs,
        userAgent: this.userAgent,
      }),
    );
  }

  private async fetchRobots(originTarget: URL): Promise<RobotsRules> {
    const origin = originTarget.origin;
    const cached = this.robotsCache.get(origin);
    if (cached && cached.expiresAt > this.now()) {
      return cached.rules;
    }

    let target = this.domainPolicy.parseTarget(new URL("/robots.txt", origin));
    let response: RawResponse | null = null;

    for (let redirectCount = 0; redirectCount <= this.maximumRedirects; redirectCount += 1) {
      response = await this.requestOnce(target, null);
      if (!REDIRECT_STATUSES.has(response.status)) {
        break;
      }

      const location = headerValue(response, "location");
      if (!location || redirectCount === this.maximumRedirects) {
        throw new OfficialSourceFetchError(
          "REDIRECT_LIMIT",
          "robots.txt exceeded the redirect limit.",
        );
      }
      target = redirectTarget(location, target, this.domainPolicy);
    }

    if (!response) {
      throw new OfficialSourceFetchError("ROBOTS_UNAVAILABLE", "robots.txt was not retrieved.");
    }

    let rules: RobotsRules;
    if (response.status === 404) {
      rules = parseRobots("", this.userAgent);
    } else if (response.status >= 200 && response.status < 300) {
      rules = parseRobots(response.body.toString("utf8"), this.userAgent);
    } else {
      throw new OfficialSourceFetchError(
        response.status === 401 || response.status === 403 ? "ROBOTS_DENIED" : "ROBOTS_UNAVAILABLE",
        "robots.txt did not grant a usable crawl policy.",
        { status: response.status },
      );
    }

    this.robotsCache.set(origin, { expiresAt: this.now() + ROBOTS_CACHE_MS, rules });
    return rules;
  }

  private async fetchHttp(value: string | URL): Promise<OfficialSourceFetchResult> {
    let target = this.domainPolicy.parseTarget(value);

    for (let redirectCount = 0; redirectCount <= this.maximumRedirects; redirectCount += 1) {
      const robots = await this.fetchRobots(target);
      if (!robots.allowed(`${target.pathname}${target.search}`)) {
        throw new OfficialSourceFetchError(
          "ROBOTS_DENIED",
          "Official source path is disallowed by robots.txt.",
          { hostname: target.hostname },
        );
      }

      const response = await this.requestOnce(target, robots.crawlDelayMs);
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = headerValue(response, "location");
        if (!location || redirectCount === this.maximumRedirects) {
          throw new OfficialSourceFetchError(
            "REDIRECT_LIMIT",
            "Official source exceeded the redirect limit.",
          );
        }
        target = redirectTarget(location, target, this.domainPolicy);
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        throw new OfficialSourceFetchError(
          "HTTP_ERROR",
          "Official source returned a non-success response.",
          { status: response.status },
        );
      }

      const contentType = responseContentType(response);
      if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
        throw new OfficialSourceFetchError(
          "UNSUPPORTED_CONTENT_TYPE",
          "Official source content type is not eligible for extraction.",
          { contentType },
        );
      }

      return {
        body: response.body,
        contentType,
        finalUrl: target.toString(),
        status: response.status,
      };
    }

    throw new OfficialSourceFetchError(
      "REDIRECT_LIMIT",
      "Official source exceeded the redirect limit.",
    );
  }

  async fetch(value: string | URL): Promise<OfficialSourceFetchResult> {
    const httpResult = await this.fetchHttp(value);
    if (
      !this.playwrightFallback ||
      !BROWSER_CONTENT_TYPES.has(httpResult.contentType) ||
      !this.playwrightFallback.shouldFallback(httpResult)
    ) {
      return httpResult;
    }

    return fetchWithPlaywright(
      this.domainPolicy.parseTarget(httpResult.finalUrl),
      {
        browserLauncher: this.browserLauncher,
        domainPolicy: this.domainPolicy,
        fetchRobots: (target) => this.fetchRobots(target),
        rateLimiter: this.rateLimiter,
        resolver: this.resolver,
        userAgent: this.userAgent,
      },
      {
        ...this.playwrightFallback,
        maximumHtmlBytes: Math.min(
          this.maximumBytes,
          this.playwrightFallback.maximumHtmlBytes ?? this.maximumBytes,
        ),
        timeoutMs: Math.min(this.timeoutMs, this.playwrightFallback.timeoutMs ?? this.timeoutMs),
      },
      this.maximumRedirects,
    );
  }
}

export { OfficialSourceFetchError } from "./errors";
export { isPublicAddress, OfficialDomainPolicy } from "./network-policy";
export { PerDomainRateLimiter } from "./rate-limit";
export {
  type PlaywrightBrowser,
  type PlaywrightBrowserContext,
  type PlaywrightBrowserLauncher,
  type PlaywrightCdpSession,
  type PlaywrightFallbackLimits,
  type PlaywrightPage,
  type PlaywrightRequest,
  type PlaywrightResponse,
  type PlaywrightRoute,
  systemPlaywrightBrowserLauncher,
} from "./playwright";
export { parseRobots } from "./robots";
