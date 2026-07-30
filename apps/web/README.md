# Athenvia web

## Standalone-mode gate

The public `/` route remains the installation landing page in mobile Safari, desktop browsers and
browsers that do not support display-mode detection.

An installed launch is detected using either:

- the standards-based `(display-mode: standalone)` media query; or
- `navigator.standalone === true`, retained for iOS Home Screen compatibility.

When either signal is active, the landing route uses `location.replace("/home")`. Replacing the
location keeps the landing page out of the installed app's Back history. The media query is also
observed for changes while the page is open. A small pre-interactive check handles the initial
installed launch before React starts, while CSS hides landing content during standards-based
standalone detection. Together they prevent the installation page from flashing before the redirect
completes.

If neither API is available, Athenvia deliberately leaves the visitor on the landing page. The
application remains directly reachable at `/home`.

## Authentication

Athenvia uses Auth.js with opaque database sessions and one-time email links. Visiting `/home` does
not require an account, so onboarding and choices stored locally can happen before sign-in. Auth.js
does not clear browser storage during the same-origin sign-in flow.

## Local email capture

Set these values in the environment used to start `apps/web`:

```dotenv
DATABASE_URL=postgresql://athenvia:athenvia@localhost:5432/athenvia
NEXTAUTH_URL=http://localhost:3000
AUTH_SECRET=replace-with-at-least-32-random-bytes
AUTH_EMAIL_FROM=Athenvia <noreply@local.athenvia>
AUTH_EMAIL_SERVER=smtp://localhost:1025
```

Generate `AUTH_SECRET` with `openssl rand -base64 32`. For local delivery, run a Mailpit container
outside the repository:

```bash
docker run --rm -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Request a link at `/sign-in`, then open <http://localhost:8025>. Mailpit keeps the message and its
token on the developer machine and no real mailbox or API key is involved.

## Production delivery

Choose one delivery configuration:

- set `AUTH_EMAIL_SERVER` to an SMTP connection URL; or
- set `AUTH_RESEND_API_KEY`, which uses Resend's TLS SMTP relay.

Set `AUTH_EMAIL_FROM` to a verified sender and `NEXTAUTH_URL` to the canonical HTTPS origin.
Production also requires a unique, high-entropy `AUTH_SECRET`. Do not log received email payloads,
magic-link URLs, verification tokens or session cookies.

Auth.js handles its double-submit CSRF cookie, hashes email tokens with SHA-256 plus
`AUTH_SECRET`, deletes a verification row atomically when used, rejects expired tokens and applies
HTTP-only, same-site cookies. Athenvia additionally enables secure cookies in production and rejects
cross-origin callback URLs.

Magic-link requests are bounded per client and per normalized email. Set `REDIS_URL` in production
for atomic limits shared by every web instance. If Redis is not configured or briefly unavailable,
the web process uses a conservative in-memory fallback; this is suitable for local development but
does not provide a global bound across multiple production instances. Requests that exceed a limit
receive the same check-email response and do not reveal account existence. Allowed requests still
require a valid Auth.js double-submit CSRF token before consuming a rate-limit bucket, then pass
through Auth.js's normal CSRF validation again before any email is sent.

## Push notification service worker

`public/sw.js` imports the notification event handlers from
`public/sw-notifications.js`. Push payloads contain only title, body, dedupe key
and an internal deep link. The handler validates an exact
`/programs/<UUID>` path and rejects absolute URLs, queries, fragments and
backslashes both when receiving a push and when handling a click.

A valid click first focuses an already-open exact programme page. Otherwise it
navigates and focuses an existing same-origin Athenvia window, falling back to
`clients.openWindow` only when necessary. Unsafe notification data is closed
without focusing, navigating or opening a window.
