# Settings security review

## Data boundaries

- Anonymous visitors can still open `/settings`, `/home`, search and public program pages.
- Settings APIs resolve the user exclusively from the Auth.js server session. They never accept a
  user ID or email from the request body.
- Private API responses use `Cache-Control: no-store`, vary on the session cookie and disable MIME
  sniffing.

## Mutation protection

- `PATCH` and `DELETE` endpoints require an exact same-origin `Origin` header. Missing, malformed,
  cross-origin and same-site subdomain origins are rejected before session or database work.
- Payloads are strict Zod objects. Unknown fields are rejected.
- Account deletion additionally requires the exact server-validated confirmation value `DELETE`.
- Sign-out uses Auth.js' built-in CSRF-protected sign-out flow.

## Deletion semantics

Deletion runs in one database transaction:

1. Delete magic-link verification tokens for the original email.
2. Delete notification deliveries, watchlists/private notes, device push credentials, provider
   accounts and every active session.
3. Replace the user's email with the non-routable `deleted-<user id>@deleted.invalid` value and
   clear verified email, name and image.

The user row is anonymized instead of physically removed because the existing schema requires a
user foreign key for community submissions. This preserves public contribution provenance without
retaining the user's personal identity. Public universities, programs and revisions also remain
intact.

Any failed statement rolls the complete transaction back, so a partial deletion is not retained.
The original email can later create a fresh, unrelated account.

## Notification unsubscribe semantics

- All active push endpoints are revoked server-side.
- Push delivery is disabled on every current watchlist.
- Scheduled, unsent deliveries are cancelled; sent audit rows remain until account deletion.
- The settings client also unsubscribes the current browser's Push API subscription after the
  server has stopped delivery.

## Residual considerations

- Notification choices are stored per watchlist because the current schema has no account-level
  preference row. A global offset is shown as selected only when every owned watchlist uses it;
  saving replaces the schedule on every owned watchlist in one transaction. A user with no tracked
  programs sees disabled controls; no misleading global preference is persisted.
- Opening day (`0`) is stored in `notify_on_open`; positive opening offsets remain in
  `before_open_days`. An empty opening selection clears both fields so disabling the category cannot
  leave pre-opening reminders active.
- The data-only `backfill_disabled_opening_reminders` migration clears positive opening offsets on
  rows where the former global opening switch was off. This runs before the new split controls are
  used, preserving existing opt-outs without changing the Prisma schema.
- Operational backups and infrastructure log retention are outside this application transaction
  and must follow the deployment's documented retention policy.
