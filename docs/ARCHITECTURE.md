# Architecture

## System overview

```text
iPhone PWA / Browser
        |
        v
Next.js web + route handlers
        |
        +---- PostgreSQL (shared catalogue + private user data)
        |
        +---- Redis/BullMQ ---- Worker
                               |-- source retrieval
                               |-- deterministic parsing
                               |-- change verification
                               `-- notification delivery
```

## Boundaries

- `apps/web` owns browser behavior, application routes and simple HTTP APIs.
- `apps/worker` owns scheduled and asynchronous processing.
- `packages/contracts` is the source of truth for cross-boundary payloads.
- `packages/database` is the source of truth for persisted structure and migrations.
- `packages/ui` owns design tokens and portable primitives.

The web application can run against contract-valid mocks before the database and worker
are available.

## Data model principles

Public catalogue data is shared. Watchlists, notes, push subscriptions and notification
history are private. Application windows support multiple rounds per intake. Changes
produce revisions instead of destructive replacement.

## Source verification

Sources are restricted to approved official domains. Retrieval uses normal HTTP first
and Playwright only where necessary. Content hashes detect changes. Date parsing is
deterministic and ambiguous results enter a review queue.

Source priority:

1. Correct official program page.
2. Official admissions page.
3. Official application portal.
4. Official university PDF.
5. Official academic calendar.
6. User-submitted official link.
7. Historical official pages used only for estimates.

## Deployment portability

The web app, worker, PostgreSQL, Redis and optional object storage remain separately
deployable. Core code must not depend on one hosting provider.
