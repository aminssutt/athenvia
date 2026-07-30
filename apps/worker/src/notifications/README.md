# Reminder scheduler

The scheduler calculates the complete desired reminder state for each watchlist,
then transactionally reconciles only pending (`SCHEDULED`) deliveries. Stable
dedupe keys use `watchlist + application window + type + offset`; dates are not
part of the key, so corrected dates update pending rows rather than creating
duplicates.

## Current time policy

The data model has no user or watchlist timezone. `opensAt` and `closesAt` are
therefore treated as exact stored UTC instants and reminder offsets are fixed
24-hour UTC days. This avoids machine-local timezone and DST behavior, but does
not claim to schedule at a user's local wall-clock time. The
`ReminderTimePolicy` interface makes this policy replaceable once a persisted
user timezone is available.

## Push eligibility

`NotificationPreference.pushEnabled` is currently legacy/inert: the existing
subscription flow does not reliably set it. Until that model is corrected, at
least one non-revoked `PushSubscription` is the authoritative eligibility
signal. If none exists, the desired reminder set is empty and stale pending
deliveries are cancelled.

## Entry points

- `rescheduleWatchlistReminders` should be called after a follow, preference
  edit, subscription change, or application-window date change.
- `reconcileUserSchedules`, `reconcileIntakeSchedules`, and
  `reconcileApplicationWindowSchedules` are trigger-oriented entry points for
  those changes.
- `runReminderScheduleSweep` is the bounded, paginated server-side safety sweep
  that eventually captures any missed trigger.

This issue is intentionally restricted to `apps/worker/src/notifications`, so
the web preference/subscription routes and application-date write paths are not
wired to these entry points here. Those callers must invoke them (or enqueue
equivalent jobs) in a follow-up integration change; the full sweep is the
server-side safety net until then.

Watchlists marked `APPLIED` do not receive opening/deadline reminders. Windows
with `NOT_PUBLISHED` dates are also excluded; both transitions cancel only stale
pending rows.

The sender/retry workers own `PROCESSING`, `SENT`, and `FAILED` rows. The
scheduler never mutates them.

## Opening reminder jobs

`prepareDueOpeningReminderJobs` reads only due `SCHEDULED`
`APPLICATION_OPENING` deliveries and prepares contract-valid queue payloads; it
does not make network calls or mutate delivery lifecycle state. Each returned
job keeps the persisted delivery ID as its queue job ID and the scheduler
dedupe key in its payload.

The batch read is bounded to deliveries due on the current UTC day so stale
rows cannot consume the limit forever. Atomic claiming and paging through more
than one batch of same-day deliveries belong to the delivery worker lifecycle.

The three supported opening offsets are 30 days, 7 days and opening day.
Confirmed and expected dates have separate copy. Expected reminders explicitly
say that the date is expected and not confirmed.

The current schema does not link an `ApplicationWindow` to the `Source` that
supports it. Until that provenance relation exists, preparation checks a
bounded newest-first set of official program sources, then
`Program.officialUrl` as fallback. The
source hostname appears in notification copy and only its canonical HTTPS
origin is returned as job metadata. Source paths, queries and fragments never
leave persistence with the job. Copy identifies it only as the program source:
because no `ApplicationWindow -> Source` relation exists, the job does not
attribute that page to `opensAt` or claim that it supports the opening date.

## PostgreSQL integration test

The repository integration test is opt-in so the ordinary test suite can run
when CI provides `DATABASE_URL` but has not migrated that database. Against a
migrated local PostgreSQL database, run:

```powershell
$env:DATABASE_URL="postgresql://athenvia:athenvia@localhost:5432/athenvia"
$env:RUN_REMINDER_DATABASE_INTEGRATION="1"
corepack pnpm --filter @athenvia/worker exec tsx --test src/notifications/repository.integration.test.ts
```
