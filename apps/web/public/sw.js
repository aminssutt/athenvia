/* global self, caches, fetch, importScripts, Response, URL */

importScripts("/sw-notifications.js");

const deploymentVersion =
  new URL(self.location.href).searchParams.get("v")?.replace(/[^a-zA-Z0-9_-]/g, "") || "fallback";
const cachePrefix = "athenvia";
const shellCacheName = `${cachePrefix}-shell-${deploymentVersion}`;
const pageCacheName = `${cachePrefix}-pages-${deploymentVersion}`;
const assetCacheName = `${cachePrefix}-assets-${deploymentVersion}`;
const currentCacheNames = new Set([shellCacheName, pageCacheName, assetCacheName]);
// `/home` is intentionally absent: it is force-dynamic and answers with
// `Cache-Control: private, no-cache, no-store` in production, so it can never
// be cached. Offline navigations to it fall back to `/offline` instead.
const shellPagePaths = new Set(["/", "/offline", "/onboarding", "/privacy"]);
const runtimeCacheablePagePaths = new Set(["/", "/offline", "/onboarding", "/privacy"]);
// Losing any of these leaves the worker unable to do its one essential job
// (a working offline fallback + installable manifest), so a miss must abort
// the install and let the previous worker keep serving.
const criticalShellUrls = ["/offline", "/manifest.webmanifest"];
const staticUrls = ["/icons/icon.svg", "/icons/icon-maskable.svg", "/icons/mark.svg"];
// Nice-to-have warm cache. Any of these may refuse caching (`no-store`) or be
// briefly unavailable; that must NEVER fail the install.
const optionalShellUrls = [...shellPagePaths].filter((path) => !criticalShellUrls.includes(path));
const emergencyOfflineHtml = `<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>You are offline · Athenvia</title>
  <body>
    <main>
      <h1>You are offline right now.</h1>
      <p>Check your connection and try again.</p>
      <a href="/home">Try again</a>
    </main>
  </body>
</html>`;

function isCacheable(response) {
  return response.ok && (response.type === "basic" || response.type === "default");
}

function responseAllowsStorage(response) {
  const cacheControl = response.headers.get("cache-control") ?? "";
  return !/\b(?:private|no-store)\b/i.test(cacheControl);
}

function assetUrlsFrom(html) {
  const urls = new Set();
  const sourcePattern = /(?:src|href)=["']([^"']+)["']/g;

  for (const match of html.matchAll(sourcePattern)) {
    const path = match[1];
    if (
      path &&
      (path.startsWith("/_next/static/") ||
        path.startsWith("/icons/") ||
        path === "/manifest.webmanifest")
    ) {
      urls.add(path);
    }
  }

  return [...urls];
}

async function fetchAndCache(cache, url) {
  const response = await fetch(url, {
    cache: "no-cache",
    credentials: "omit",
  });
  if (!isCacheable(response) || !responseAllowsStorage(response)) {
    throw new Error(`Could not cache ${url}`);
  }
  await cache.put(url, response.clone());
  return response;
}

async function cacheShellPage(shellCache, discoveredAssets, url) {
  const response = await fetchAndCache(shellCache, url);
  if (response.headers.get("content-type")?.includes("text/html")) {
    for (const assetUrl of assetUrlsFrom(await response.text())) {
      discoveredAssets.add(assetUrl);
    }
  }
}

async function cacheShell() {
  const shellCache = await caches.open(shellCacheName);
  const assetCache = await caches.open(assetCacheName);
  const discoveredAssets = new Set();

  // Critical resources: a rejection here rejects the install on purpose.
  await Promise.all([
    ...criticalShellUrls.map((url) => cacheShellPage(shellCache, discoveredAssets, url)),
    ...staticUrls.map((url) => fetchAndCache(assetCache, url)),
  ]);

  // Best-effort warm-up: pages that refuse caching (e.g. `no-store` on
  // dynamic routes in production) must never make the install fail.
  await Promise.allSettled(
    optionalShellUrls.map((url) => cacheShellPage(shellCache, discoveredAssets, url)),
  );

  await Promise.allSettled([...discoveredAssets].map((url) => fetchAndCache(assetCache, url)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((names) =>
          Promise.all(
            names
              .filter((name) => name.startsWith(`${cachePrefix}-`) && !currentCacheNames.has(name))
              .map((name) => caches.delete(name)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    event.waitUntil(self.skipWaiting());
  }
});

async function networkFirstPage(request, canCachePage, canUseShellPage) {
  const pageCache = canCachePage ? await caches.open(pageCacheName) : null;
  const shellCache = await caches.open(shellCacheName);

  try {
    const response = await fetch(request);

    if (pageCache && isCacheable(response) && responseAllowsStorage(response)) {
      await pageCache.put(request, response.clone());
    }
    return response;
  } catch {
    const cachedPage = canUseShellPage
      ? ((pageCache ? await pageCache.match(request) : null) ?? (await shellCache.match(request)))
      : null;
    return (
      cachedPage ??
      (await shellCache.match("/offline")) ??
      new Response(emergencyOfflineHtml, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
        status: 503,
      })
    );
  }
}

async function cacheFirstAsset(request) {
  const assetCache = await caches.open(assetCacheName);
  const shellCache = await caches.open(shellCacheName);
  const cached = (await assetCache.match(request)) ?? (await shellCache.match(request));
  if (cached) {
    return cached;
  }

  const response = await fetch(request);
  if (isCacheable(response)) {
    await assetCache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("range")
  ) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirstPage(
        request,
        runtimeCacheablePagePaths.has(url.pathname),
        shellPagePaths.has(url.pathname),
      ),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/manifest.webmanifest"
  ) {
    event.respondWith(cacheFirstAsset(request));
  }
});
