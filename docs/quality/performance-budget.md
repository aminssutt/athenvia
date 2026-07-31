# Performance budget

> Note: this worktree only carries the service-worker finding below. Merge this
> section into the full performance budget document authored alongside it.

## Findings

### CRITICAL — Service worker never installs in production — FIXED

- **Status:** Fixed.
- **Fix reference:** `apps/web/public/sw.js` (`cacheShell()` split into critical
  vs best-effort precache) and `apps/web/tests/e2e/pwa.spec.ts` (assertion no
  longer requires `/home` in the shell cache and now asserts its absence).
- **Original defect:** `cacheShell()` precached every shell page (including
  `/home`) with `Promise.all` over a `fetchAndCache()` that throws when the
  response carries `Cache-Control: no-store`. In production `/home` is
  `force-dynamic` and answers `private, no-cache, no-store`, so the `install`
  event always rejected: the service worker never installed in production — no
  offline fallback, no asset cache, no update flow. The e2e suite missed it
  because it runs against `next dev` (different cache headers) and even
  asserted that `/home` was cached.
- **Resolution:**
  - The precache is now two-phase. Critical resources — the `/offline`
    fallback, `/manifest.webmanifest`, and the hardcoded static icons — are
    still fetched with `Promise.all` and still abort the install when missing,
    because a worker without its offline fallback is useless. The remaining
    shell pages (`/`, `/onboarding`, `/privacy`) and discovered
    `_next/static` assets are warmed best-effort with `Promise.allSettled`:
    a page that refuses caching can never fail the install again.
  - `/home` was removed from the shell page list entirely. It can never be
    cached (its `no-store` response is also rejected by the runtime
    `responseAllowsStorage` guard), and offline navigations to `/home` are
    already served by the `/offline` fallback in `networkFirstPage()`.
- **Production verification:** validated against a production build
  (`next build` + `next start`): `/home` answers
  `Cache-Control: private, no-cache, no-store` there, every critical precache
  URL answers cacheable headers, and the real service worker install flow
  (the `pwa.spec.ts` suite pointed at the production server) completes
  successfully despite the `no-store` response.
