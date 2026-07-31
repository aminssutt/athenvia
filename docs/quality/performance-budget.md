# PWA performance budget

Issue: [P5-11] Review PWA performance budgets (#102)
Review date: 2026-07-31
Reviewed build: `apps/web` production build (Next.js 16, Turbopack), measured from the
`.next` output of `corepack pnpm --filter @athenvia/web build`.

## Why these numbers

Athenvia is a mobile-first PWA. The reference device is a mid-range Android phone on a
throttled 4G connection (~1.6 Mbps effective, ~150 ms RTT). On that class of device,
every ~35 kB of gzipped JavaScript costs roughly 100 ms of download plus 100-150 ms of
parse/execute. Keeping First Load JS at or below ~130 kB gzip keeps the JS cost of a
cold navigation under ~1.5 s, which combined with server-rendered HTML keeps
Time to Interactive in the 2-3 s range without needing lab tooling to confirm every
release. The budget is set from the current measurements (worst route: 100.3 kB gz)
plus ~30% headroom, so any regression that eats the headroom is a deliberate decision,
not drift.

## Budget (per core route, production build)

| Metric                                 | Budget                                    | Rationale                                                                           |
| -------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------- |
| First Load JS (gzip)                   | <= 130 kB                                 | Worst route today is 100.3 kB; 30% headroom                                         |
| Shared layout JS (gzip)                | <= 25 kB                                  | Today 16.1 kB; the root layout ships on every page                                  |
| Route CSS (gzip)                       | <= 15 kB                                  | Today <= 9.7 kB (Tailwind 4, per-route modules)                                     |
| Web fonts                              | 0 bytes                                   | System font stack + Georgia; no webfont may be added without revisiting this budget |
| Local images in the app shell          | SVG only, <= 5 kB each                    | Today the largest is 428 B                                                          |
| Remote images (university logos)       | lazy + async decode, fixed-size container | Prevents CLS and off-screen downloads                                               |
| TTI proxy (cold, mid-range Android 4G) | <= 3 s                                    | Follows from the JS budget + SSR HTML; verify with Lighthouse when available        |

A route fails the budget when its First Load JS (gzip) exceeds 130 kB in the production
build. CI does not enforce this yet; re-measure on any PR that adds a dependency to a
client component (see "How to re-measure" below).

## Current measurements (2026-07-31)

First Load JS = shared root-layout chunks (16.1 kB gz) + route-specific client chunks,
gzip level 9. Raw (uncompressed) sizes shown for parse-cost awareness.

| Route                    | First Load JS (gz) | Raw JS | Route CSS (gz) | Verdict |
| ------------------------ | -----------------: | -----: | -------------: | :-----: |
| `/programs/[programId]`  |           100.3 kB | 403 kB |         9.7 kB |  PASS   |
| `/settings`              |           100.1 kB | 411 kB |         9.7 kB |  PASS   |
| `/search`                |            92.9 kB | 381 kB |         9.7 kB |  PASS   |
| `/contribute/program`    |            91.2 kB | 378 kB |         9.7 kB |  PASS   |
| `/contribute/university` |            89.5 kB | 372 kB |         9.7 kB |  PASS   |
| `/home`                  |            44.1 kB | 146 kB |         9.7 kB |  PASS   |
| `/notifications`         |            43.5 kB | 145 kB |         9.7 kB |  PASS   |
| `/sign-in`               |            32.2 kB | 115 kB |         3.6 kB |  PASS   |
| `/onboarding`            |            25.2 kB |  90 kB |         5.0 kB |  PASS   |
| `/admin`                 |            24.6 kB |  87 kB |         4.6 kB |  PASS   |
| `/` (landing)            |            23.6 kB |  84 kB |         5.5 kB |  PASS   |
| `/privacy`               |            23.4 kB |  83 kB |         3.6 kB |  PASS   |
| `/sign-in/check-email`   |            23.3 kB |  83 kB |         3.6 kB |  PASS   |
| `/offline`               |            23.3 kB |  83 kB |         3.6 kB |  PASS   |

**Every route is within budget.** No optimisation was applied as part of this review;
the notable improvement opportunities below are recommendations, not requirements.

### Where the bytes go

- Shared layout: 16.1 kB gz (React + Next runtime entry, service-worker registration).
- One chunk dominates the five heaviest routes: **zod v4 (classic build), 63.0 kB gz /
  277 kB raw**, pulled into the client bundle because client components validate API
  responses at runtime (`program-search.tsx` -> `SearchResponseSchema`,
  `settings-client.tsx` -> `NotificationSettingsResponseSchema`,
  `follow-program-request.ts` -> inline `z` schema, both contribute form submission
  schemas). The chunk is shared and cached across those routes, so the cost is paid
  once per deployment, not per route.
- Everything else is app code in 1-21 kB gz route chunks; no other third-party
  dependency reaches the client bundle.

## Service worker review (`apps/web/public/sw.js`)

### Strategies in place (correct)

| Resource                                        | Strategy                        | Notes                                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Navigations (HTML)                              | Network-first, offline fallback | HTML is never served cache-first; only an allow-listed set (`/`, `/offline`, `/onboarding`, `/privacy`) is runtime-cached, so authenticated pages never land in Cache Storage |
| `/_next/static/*`                               | Cache-first                     | Safe: content-hashed, immutable per deployment                                                                                                                                |
| `/icons/*`, manifest                            | Cache-first                     | Tiny SVGs                                                                                                                                                                     |
| `/api/*`, non-GET, range requests, cross-origin | Bypassed                        | Correct                                                                                                                                                                       |

Versioning is done right: cache names embed the deployment id
(`sw.js?v=<NEXT_PUBLIC_ATHENVIA_DEPLOYMENT_ID>`), `activate` deletes stale
`athenvia-*` caches, registration uses `updateViaCache: "none"`, updates are checked
hourly and on visibility change, and a new deployment waits for explicit user consent
(`SKIP_WAITING` + one-time reload). `responseAllowsStorage()` refuses to store any
response marked `private` or `no-store`.

### CRITICAL finding (FIXED): shell precache can fail the whole install in production

> **Status: FIXED** in the same PR that merged this section. `cacheShell()` now
> precaches in two phases — `/offline`, the manifest and the static icons remain
> hard install requirements, while the remaining shell pages are cached
> best-effort with `Promise.allSettled` — and `/home` was removed from
> `shellPagePaths` entirely (it can never be stored, and offline navigations to
> it already fall back to `/offline`). Verified against a production build
> (`next build` + `next start`): with the old worker, `pwa.spec.ts` fails
> exactly as described below; with the fix, install, activation and the update
> flow all pass despite the `no-store` header. The e2e assertion now checks
> `/home` is **not** in the shell cache. The original analysis is kept below
> for the record.

`cacheShell()` precaches `shellUrls` with `Promise.all(...)`, and `fetchAndCache()`
**throws** when a response is not storable. `shellPagePaths` includes `/home`, which is
`force-dynamic`. Headers measured on the production Docker image
(`athenvia-observability-smoke-web-1`, Next standalone server):

```text
/            -> 200  cache-control: s-maxage=31536000
/home        -> 200  cache-control: private, no-cache, no-store, max-age=0, must-revalidate
/offline     -> 200  cache-control: s-maxage=31536000
/onboarding  -> 200  cache-control: s-maxage=31536000
/privacy     -> 200  cache-control: s-maxage=31536000
```

`/home` is `no-store`, so `fetchAndCache("/home")` throws, `Promise.all` rejects,
`install`'s `waitUntil` rejects, and **the service worker never installs in
production** — no offline shell, no asset cache, no update flow. The e2e test
(`tests/e2e/pwa.spec.ts`) passes because it runs against `next dev`, which does not
send the production `no-store` header, so it asserts `/home` ends up in the shell
cache — an assertion that cannot hold in production.

Suggested fix (needs its own PR + a prod-headers regression test, deliberately not
applied in this performance review): precache shell **pages** best-effort
(`Promise.allSettled`) while keeping `/offline` a hard requirement, or drop `/home`
from `shellPagePaths` (offline navigations to `/home` already fall back to
`/offline`). Update the e2e assertion to match, and run it against a production
server (`next build` + standalone start), not `next dev`.

### Minor observations

- `cacheFirstAsset()` stores network responses after checking `isCacheable()` but not
  `responseAllowsStorage()`. Harmless for the current allow-list (immutable
  `/_next/static`, icons, manifest), but inconsistent with `fetchAndCache()`.
- The prerendered HTML pages are served with `s-maxage=31536000` and no ETag-based
  revalidation directive for shared caches. There is no CDN in the current Dokploy
  setup so this is dormant, but if a caching proxy is ever added, year-old HTML could
  reference purged `/_next/static` chunks. Keep in mind before fronting the app with a
  CDN.
- The install-time precache fetches with `credentials: "omit"`, so any personalised
  shell page would be cached in its anonymous variant. Currently moot (see critical
  finding), but relevant when deciding what belongs in `shellPagePaths`.

## Images and fonts review

- **Fonts: zero webfont bytes.** `globals.css` uses a system-ui stack plus Georgia for
  display text. Nothing to fix — this is the single biggest reason the routes render
  fast; keep it in the budget as a hard 0.
- **Local images are all SVG and tiny** (largest: `icon-maskable.svg`, 428 B). The
  brand mark goes through `next/image` with explicit `width`/`height` (no CLS); for an
  SVG it is served as-is, which is fine.
- **Remote university logos** use a native `<img>` (deliberate: keeps approved remote
  hosts independent of `next/image` host configuration) with `loading="lazy"`,
  `decoding="async"`, `referrerPolicy="no-referrer"`, an `onError` monogram fallback,
  and a fixed-size square container (`aspect-ratio: 1` + explicit width) — no CLS, no
  eager off-screen downloads. No change needed.
- No raster images anywhere in the app shell, so `next/image` optimisation pipelines,
  AVIF/WebP negotiation, and `sizes` audits are currently moot.

## Prioritised recommendations

1. **P0 — Fix the service-worker install failure in production** (critical finding
   above). Until then the offline shell, asset cache and update-consent flow are dead
   code in production. Add a regression test that runs the PWA e2e against a
   production build, or a unit test pinning `shellPagePaths` to routes whose
   `Cache-Control` allows storage.
2. **P1 — Get zod out of the client bundle (~63 kB gz off the five heaviest routes).**
   Options, in increasing effort: import `zod/mini` in `@athenvia/contracts` schemas
   consumed by client components; or stop runtime-parsing API responses in the browser
   (the API is same-origin and already validated server-side — a typed `as` cast plus
   a thin shape check would keep routes at ~30-40 kB gz). Functional change; needs its
   own tests, out of scope for this review.
3. **P2 — Align `cacheFirstAsset()` with `responseAllowsStorage()`** for consistency.
4. **P2 — Revisit `s-maxage=31536000` HTML before ever adding a CDN/proxy layer.**

## How to re-measure

Next 16 (Turbopack) no longer prints the per-route First Load JS table, so measure
from the build output. After `corepack pnpm --filter @athenvia/web build`, for each
`apps/web/.next/server/app/**/page_client-reference-manifest.js`, evaluate the file
(it assigns `globalThis.__RSC_MANIFEST[route]`) and read `entryJSFiles` /
`entryCSSFiles`: they list exactly the `static/chunks/*` files loaded on first render
for the layout and the page. Gzip each referenced file (`zlib.gzipSync`, level 9) and
sum; the layout entry is the shared baseline, the page entry adds the route-specific
chunks. Compare the per-route totals against the budget table above.
