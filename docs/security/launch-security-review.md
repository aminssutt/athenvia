# Launch security review

Ticket: [P5-09] Complete the launch security review (#100)

Scope requested: authentication, SSRF, CSRF, rate limiting, and private-data
isolation. This document records a read-only review of the current branch. No
application code was changed; every fix is expected to land as a separate ticket
or PR.

## Methodology

- Static reading of every route handler under `apps/web/app/api/**`, the shared
  auth and request-security helpers, the worker fetch and delivery paths, and
  the observability redaction layer.
- Each finding was confirmed against the real source before inclusion. Two
  findings were additionally reproduced with a local Node script (the redirect
  parser behaviour) or traced end to end through the worker send path (the push
  endpoint SSRF). Speculative issues that did not survive re-reading the code
  were dropped.
- Baseline of record: `docs/SECURITY.md`, `docs/ARCHITECTURE.md`, and
  `docs/operations/observability.md`.

Severity scale: **P0** critical (exploitable, high impact), **P1** high, **P2**
medium, **P3** low.

## Domain checklist

| Domain                              | Status | Summary                                                                                                                                                                    |
| ----------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Authentication / session            | ✅     | Database sessions, secure cookies in prod, ownership always resolved from the session identity, admin gated by env allowlist + DB lookup.                                  |
| Authorization / IDOR                | ✅     | Watchlist, notifications, push, and settings all scope Prisma queries by the session `userId`; identifiers are never taken from the request body.                          |
| CSRF                                | ✅     | Every state-changing route verifies `Origin` + `Sec-Fetch-Site`; the magic-link POST additionally validates the NextAuth double-submit token with a constant-time compare. |
| SSRF (worker source fetch)          | ✅     | Approved-host allowlist, DNS pinning, private/reserved-range rejection (IPv4 + IPv6), redirect re-validation, no HTTPS→HTTP downgrade.                                     |
| SSRF (web push delivery)            | ✅     | Fixed: push endpoints are DNS-resolved and checked against private/reserved ranges at registration and again at send time (P2-01).                                         |
| Open redirect (auth)                | ✅     | Fixed: `safeAuthRedirect` now resolves every candidate against the base URL and requires an exact origin match (P2-02).                                                    |
| Rate limiting                       | ✅     | Search, submissions, magic-link, and push mutations are limited (P3-01 fixed). Forwarding headers are normalized to the trusted proxy hop in `proxy.ts` (P3-02 fixed).     |
| Private-data isolation in responses | ✅     | No email/token/endpoint leakage in user-facing API responses; admin-only responses expose reviewer email inside the gated admin surface only.                              |
| Logging / redaction                 | ✅     | Allowlist log formatters plus pino redaction; request IDs regenerated server-side; raw path and error message never logged.                                                |

## Findings

### Summary by severity

- P0: 0
- P1: 0
- P2: 2
- P3: 2

No P0 or P1 issues were found. The auth, CSRF, IDOR, and worker-fetch SSRF
surfaces are in good shape. The two P2 items were a bypassable auth redirect and
a blind SSRF vector on the push-delivery path.

**Status update:** all four findings (P2-01, P2-02, P3-01, P3-02) have been
fixed; each finding below records its resolution.

---

### P2-01 — Web Push endpoint is a blind SSRF sink (no DNS / private-range check)

- `apps/web/app/api/push/subscriptions/route.ts:26` (`isSecurePushEndpoint`)
- `apps/worker/src/web-push-transport.ts:43` (`WebPushNotificationTransport.send`)

`isSecurePushEndpoint` accepts any `https:` URL whose hostname contains a dot,
is not a bare IP literal, and does not end in `.local` / `.localhost`. It never
resolves the hostname. The worker later calls `sender.sendNotification` against
that stored `endpoint` with no DNS pinning and no private-address rejection.

This is materially weaker than the university-website path
(`apps/web/app/api/university-submissions/safe-url.ts`), which resolves DNS and
rejects loopback, link-local, and private ranges — exactly what
`docs/SECURITY.md` line 7 requires "before retrieval".

Exploitation scenario: an authenticated user registers a subscription whose
`endpoint` is `https://attacker-domain.example/...`, where `attacker-domain`
resolves (or is rebound) to an internal address (e.g. `169.254.169.254`,
`10.0.0.0/8`, a service on the Docker `backend` network). When a notification
fires, the worker issues an HTTPS POST to that internal target. It is a blind
SSRF (the encrypted push body is sent, the response is not returned to the
attacker), but it lets an authenticated user drive server-side POSTs at internal
hosts that the worker can reach.

Recommendation: apply the same DNS-resolution + `isPublicAddress`-style check to
push endpoints before persisting and, ideally, again at send time; or restrict
endpoints to a known allowlist of push-service hosts. Reuse the existing
`safe-url.ts` / `network-policy.ts` primitives rather than duplicating logic.

**Status: fixed.** DNS-resolution + public-address validation was chosen over a
strict host allowlist so legitimate push services keep working without an
operational allowlist to maintain. At registration,
`apps/web/app/api/push/subscriptions/endpoint-safety.ts` resolves the endpoint
hostname (reusing `isPublicNetworkAddress` from
`apps/web/app/api/university-submissions/safe-url.ts`) and the route rejects
any endpoint with a non-public address. At send time — because DNS can change
or be rebound between registration and delivery —
`apps/worker/src/push-endpoint-safety.ts` (reusing `isPublicAddress` from
`apps/worker/src/fetch/network-policy.ts`) re-validates inside
`WebPushNotificationTransport.send`; an endpoint resolving to a non-public
address raises `UnsafePushEndpointError`, which `classifyWebPushFailure` maps
to `INVALID_SUBSCRIPTION` so the subscription is revoked. Transient DNS
failures raise `PushEndpointResolutionError` and are classified `TRANSIENT`
(no request was made, so retrying is safe). Covered by
`endpoint-safety.test.ts`, `route.test.ts`, `push-endpoint-safety.test.ts`,
`web-push-transport.test.ts`, and `push-retries.test.ts`.

---

### P2-02 — Open redirect in `safeAuthRedirect` (relative-path guard bypass)

- `apps/web/lib/auth-config.ts:110` (`safeAuthRedirect`)

The guard `url.startsWith("/") && !url.startsWith("//")` is intended to allow
only same-origin relative paths, returning `new URL(url, baseUrl)` immediately
without an origin check. The WHATWG URL parser normalizes backslashes to slashes
for special schemes and strips tab/newline characters, so several inputs pass
the guard yet resolve to an external origin.

Reproduced locally against `base = https://app.athenvia.com`:

| Input (`callbackUrl`) | Passes guard | Resolved origin    |
| --------------------- | ------------ | ------------------ |
| `/\evil.com`          | yes          | `https://evil.com` |
| `/\/evil.com`         | yes          | `https://evil.com` |
| `/<TAB>/evil.com`     | yes          | `https://evil.com` |
| `/<LF>/evil.com`      | yes          | `https://evil.com` |

`safeAuthRedirect` is the NextAuth `redirect` callback, so a crafted
`callbackUrl` sends the user to an attacker origin after sign-in — a phishing /
credential-relay primitive in the auth flow.

Recommendation: reject any candidate whose second character is `/` **or** `\`,
strip ASCII control characters before evaluating, and — most robustly — always
resolve against `baseUrl` and then verify `destination.origin === baseUrl`
origin before returning (i.e. fold the relative branch into the same
origin-equality check the absolute branch already uses). Add the table above as
regression tests.

**Status: fixed.** `safeAuthRedirect` (`apps/web/lib/auth-config.ts`) now
resolves every candidate against the base URL with `new URL(url, base)` and
returns it only when `destination.origin === base.origin`; everything else
falls through to `/home`. The bypass table above (backslash, double-backslash,
tab, newline, and carriage-return variants) is covered as regression tests in
`apps/web/lib/auth-config.test.ts`.

---

### P3-01 — Push subscription mutation endpoints are not rate-limited

- `apps/web/app/api/push/subscriptions/route.ts` (POST / DELETE)

`docs/SECURITY.md` line 4 lists push among the endpoints that must be rate
limited. The subscribe/revoke handlers enforce origin, auth, content-type, and
strict schema validation, but no rate limiter. A per-user active-subscription
cap exists in the database layer
(`PushSubscriptionLimitReachedError`), which bounds stored rows, so impact is
limited to request-volume abuse (DB writes / advisory-lock contention) rather
than unbounded growth. Still a documented-requirement gap.

Recommendation: apply the existing fixed-window limiter (user + client key) to
both methods, mirroring the submission endpoints.

**Status: fixed.** `apps/web/app/api/push/subscriptions/rate-limit.ts` mirrors
the university-submission limiter (Redis fixed window with a bounded in-memory
fallback, HMAC-opaque user + client keys, optional
`PUSH_SUBSCRIPTION_RATE_LIMIT_SALT`): 20 mutations per user and 60 per client
per 10 minutes. Both `POST` and `DELETE` return 429 with `RateLimit-*` and
`Retry-After` headers when exceeded. Covered by `rate-limit.test.ts` and
`route.test.ts`.

---

### P3-02 — IP-based rate-limit keys trust unverified forwarding headers

- `apps/web/app/api/search/rate-limit.ts:70`
- `apps/web/lib/auth-rate-limit.ts:85`
- `apps/web/app/api/university-submissions/rate-limit.ts:127`

Client-address derivation reads `x-forwarded-for` / `x-real-ip` /
`cf-connecting-ip` directly from the request. For authenticated endpoints a
user-scoped key also applies, so the effect is contained. For unauthenticated
search, the IP key is the only limiter, and an attacker who can set these
headers (i.e. if the edge proxy does not overwrite them) rotates the key per
request and evades the 30/min limit.

Note: `proxy.ts` correctly regenerates `x-request-id` and never trusts the
client value, but no equivalent normalization exists for the forwarding headers.

Recommendation: derive the client IP from a trusted hop count / the proxy's
authoritative header only, and document that the reverse proxy must overwrite
`x-forwarded-for` at ingress. This is partly a deployment concern (Dokploy /
reverse-proxy configuration) and should be verified there as well.

**Status: fixed.** `apps/web/proxy.ts` — which already regenerates
`x-request-id` — now also normalizes the forwarding headers for every `/api/*`
request before any handler sees them: the production deployment
(`docker-compose.prod.yml`) fronts the app with a single reverse proxy that
appends the real client address as the _last_ `x-forwarded-for` entry, so the
proxy keeps only that final hop, rewrites `x-forwarded-for` and `x-real-ip` to
it, and drops `cf-connecting-ip` entirely (no Cloudflare in front of this
deployment). When no forwarding header is present (direct/dev traffic) the
headers are removed so limiters fall back to the shared `"unknown"` key rather
than a client-chosen one. Existing rate-limit key derivations needed no change.
Covered by `apps/web/lib/proxy.test.ts`. Operationally, the reverse proxy in
front of `web` must keep appending the client address to `x-forwarded-for`
(the default for Traefik and nginx `proxy_add_x_forwarded_for`).

---

## Verified-healthy areas (evidence)

- **Session & ownership.** `authenticatedUserId`
  (`apps/web/app/api/watchlist/request-security.ts:53`), `getAuthenticatedUser`
  (`apps/web/app/api/settings/authenticated-user.ts:11`), and
  `authenticatedPushUserId`
  (`apps/web/app/api/push/subscriptions/request-security.ts:38`) all resolve the
  user id from the database session, never from request input. `unfollowProgram`
  (`packages/database/src/watchlists.ts:129`) and `revokePushSubscription`
  (`packages/database/src/push-subscriptions.ts:184`) filter by `userId`, so a
  guessed watchlist / endpoint id cannot affect another account. Notification
  history double-scopes (`userId` and `watchlist.userId`) at
  `apps/web/app/api/notifications/history.ts:56`.
- **Admin authorization.** `resolveAdminAccess`
  (`apps/web/app/api/admin/reviews/security.ts:25`) requires the session email
  to be in `ATHENVIA_ADMIN_EMAILS` and to resolve to a real user; every admin
  write additionally calls `isTrustedAdminWrite`. The admin page performs the
  same check server-side before rendering.
- **CSRF.** Origin + `Sec-Fetch-Site` checks on watchlist, push, settings,
  program- and university-submission mutations. The magic-link POST
  (`apps/web/app/api/auth/[...nextauth]/route.ts:46`) validates the NextAuth
  CSRF token with `timingSafeEqual` (`apps/web/lib/auth-csrf.ts:52`).
- **Worker fetch SSRF.** `OfficialDomainPolicy`
  (`apps/worker/src/fetch/network-policy.ts`) enforces an explicit approved-host
  allowlist, rejects IP-literal hosts, credentials, and non-standard ports;
  `resolvePublicTarget` rejects non-public resolved addresses; `pinnedRequest`
  (`apps/worker/src/fetch/request.ts:29`) pins the connection to the resolved
  address; redirects are re-validated and HTTPS→HTTP downgrades are blocked
  (`apps/worker/src/fetch/index.ts:74`).
- **Logging redaction.** Web and worker loggers use allowlist formatters plus
  pino `redact` for `authorization`, `cookie`, `email`, `endpoint`, `token`,
  `url`, `body`, `payload`, `job.data`, etc. Error serializers keep only the
  class name (`apps/web/lib/observability.ts`,
  `apps/worker/src/observability.ts`). The raw request path is intentionally not
  logged; route templates are used instead.
- **Health endpoints.** `/api/health` and `/api/health/worker` return only
  `ok` / `unavailable` and leak no dependency detail.

## Accepted residual risks

- **`allowDangerousEmailAccountLinking: true` on Google**
  (`apps/web/lib/auth.ts:36`). Mitigated by the `email_verified === true` gate
  in the `signIn` callback (`isVerifiedGoogleProfile`,
  `apps/web/lib/auth-config.ts:46`) and by the fact that email ownership is
  already provable through the magic-link provider. Documented and accepted;
  revisit if a non-email-verifying provider is ever added.
- **Rate-limiter memory fallback.** All limiters fall back to a bounded
  in-process map when Redis is unavailable, giving per-instance rather than
  global limits. Acceptable for the current single-worker / small-web-replica
  deployment; revisit before horizontal scale-out.
- **Unauthenticated health endpoints.** Intentional, per
  `docs/operations/observability.md`; safe because they expose only status.

## Suggested follow-up tickets

All four follow-ups below have been completed; see the per-finding status notes
above for implementation and test references.

1. ~~P2-02 open redirect — tighten `safeAuthRedirect` and add the bypass table
   as tests.~~ Done.
2. ~~P2-01 push-endpoint SSRF — reuse `safe-url` / `network-policy` DNS +
   public address checks for push endpoints at store and send time.~~ Done.
3. ~~P3-01 push rate limiting.~~ Done.
4. ~~P3-02 trusted-hop IP derivation + proxy ingress hardening.~~ Done
   (application side; keep verifying the reverse-proxy ingress configuration on
   deployment changes).
