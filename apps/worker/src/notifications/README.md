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

## Deadline reminder jobs

`prepareDueDeadlineReminderJobs` applies the same read-only preparation and
revalidation boundary to due `SCHEDULED` `APPLICATION_DEADLINE` deliveries.
It supports only the canonical 30, 14, 7 and 2 day offsets. The database read
is bounded to the current UTC day, and preparation additionally requires the
current application-window `closesAt` instant to be strictly later than the
preparation clock. Stale jobs therefore cannot describe an already-passed
deadline.

Confirmed and expected deadlines use separate copy. Every expected payload
states both that the deadline is expected and that it is not confirmed.
Program-source handling matches opening reminders: only a canonical HTTPS
origin and hostname leave persistence, with no path, query, credentials or
fragment. Because the schema has no application-window source relation, the
copy identifies the page only as the program source and never claims that it
supports `closesAt`.

Preparation does not claim a delivery, mutate lifecycle state or make a network
request. Atomic `SCHEDULED -> PROCESSING` claims, queue paging and Web Push
delivery remain sender responsibilities.

## Application-date change notifications

`planDateChangeNotifications` consumes one approved `DataRevision` for an
`APPLICATION_WINDOW.opensAt` or `APPLICATION_WINDOW.closesAt` field. Planning
runs in a transaction under the exact canonical revision conflict-key advisory
lock (`APPLICATION_WINDOW:<entityId>:<fieldName>`). The stored nullable
`conflictKey` must equal that derived value, while pending-conflict reads always
use the derived value so a missing or mismatched stored key cannot bypass
conflict handling. The planner inserts `DATE_CHANGED` deliveries with the
stable unique key
`athenvia:date-change:v1:<watchlistId>:<revisionId>`. Repeating the same call is
idempotent because insertion uses the schema's unique `dedupeKey`.

Recipient planning uses deletion-safe keyset pages of 250 watchlists rather
than hydrating an unbounded intake relation. Before creating each latest
revision page, it cancels only still-`SCHEDULED` date-change deliveries whose
strict dedupe key points to an older revision for the same application window,
entity type, and field. Cancellation reads are themselves paged in bounded
chunks. This prevents an obsolete revision rejected during preparation from
permanently filling the due batch; ignored or otherwise invalid latest
revisions still cancel those now-undeliverable older rows but create nothing.
No delivery for another window or field is cancelled.

The revision must be approved, have a non-future `reviewedAt`, be the latest
approved revision for its entity and field, and have neither its conflict flag
nor a competing pending revision. Its evidence must be an official HTTPS
source with a snapshot that belongs to that exact source. A programme-specific
source must belong to the changed programme; only a source without a programme
may fall back to the programme's university. Only the canonical HTTPS origin
and hostname leave persistence, never credentials, ports, paths, queries or
fragments.

Revision values accept only `null`, an ISO `YYYY-MM-DD` date, or a complete
RFC3339 instant with a timezone. They are normalized to UTC date keys because
the notification copy displays a calendar date. The current canonical
application-window value must match the approved `newValue` by that normalized
UTC date (or both must be null), otherwise the revision is stale and produces
nothing.

The material cases are a newly published date, a removed date with no
replacement published, or a move to another UTC calendar day. Same-day
representation/time changes and `null -> null` are ignored. Historical-only
changes are also ignored: at least one non-null old/new date must be on or
after the revision's UTC `reviewedAt` day. This retains future-to-past and
past-to-future corrections while suppressing corrections whose affected dates
were already historical when reviewed.

Eligible recipients must have followed the exact programme and intake before
the revision was reviewed, must not be `APPLIED`, must still have an active
push subscription, and must have active programme/university catalogue
entities. `notifyOnDateChange` defaults to true when no preference row exists.
Preparation revalidates the revision, canonical value, latest-approved status,
evidence, recipient ownership and eligibility. Confirmed and expected copy
shows old/new dates clearly; expected copy explicitly says expected, not
confirmed. Removal copy states that no new date is published. Preparation is
read-only and performs neither lifecycle mutation nor network delivery.
The due-reader runs one transaction per batch and memoizes hydration by
revision ID, so several deliveries from one revision cause one revision
revalidation read rather than one transaction per recipient.

The approval flow is wired in two halves. The web admin approval applies
`newValue` to the canonical `ApplicationWindow` atomically with the review
decision (`apps/web/app/api/admin/reviews/service.ts`), satisfying the
evidence trigger by adopting the revision's source and its `lastCheckedAt` as
the new verification instant. The worker cannot be called synchronously from
the web app, so `runDateChangePlanningSweep` (`date-change-sweep.ts`) re-scans
recently approved application-window revisions every minute and feeds each one
to `planDateChangeNotifications`; replanning is idempotent thanks to the
deterministic dedupe keys and the planner's own staleness checks. Deadline and
opening reminders need no extra wiring: the reminder schedule sweep reconciles
them from the updated canonical window. Delivery claiming and Web Push sending
remain sender-worker responsibilities.

## PostgreSQL integration test

The repository integration test is opt-in so the ordinary test suite can run
when CI provides `DATABASE_URL` but has not migrated that database. Against a
migrated local PostgreSQL database, run:

```powershell
$env:DATABASE_URL="postgresql://athenvia:athenvia@localhost:5432/athenvia"
$env:RUN_REMINDER_DATABASE_INTEGRATION="1"
corepack pnpm --filter @athenvia/worker exec tsx --test src/notifications/repository.integration.test.ts
```
