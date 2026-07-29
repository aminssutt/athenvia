# Athenvia roadmap

## Goal

Deliver a calm, mobile-first PWA that lets a student discover a university program,
understand its next application date, follow it and receive a correctly worded reminder.

## Phase 0 — Unblock and freeze contracts

Create the monorepo, local services, strict shared configuration, first Prisma schema,
domain contracts, mock responses, design tokens, PWA manifest, worker scaffold, CI and
repository rules.

**Exit:** the frontend builds and runs from mocks, contracts are tested, Prisma validates,
and CI covers formatting, lint, types, tests and build.

## Phase 1 — Product shell

Build the landing and installation journey, standalone routing, onboarding, home,
search, program details, follow flow, private watchlist, authentication, application
APIs and the reusable mobile design system.

**Exit:** a student can search, inspect and follow a program.

## Phase 2 — Shared enrichment

Build missing-university and missing-program contributions, normalization, duplicate
detection, retrieval queues, safe official-source fetching, snapshots, deterministic
date extraction, expected-date rules, revisions and an admin review queue.

**Exit:** an approved contribution becomes shared catalogue data with provenance and
history.

## Phase 3 — Notifications

Build VAPID setup, push subscriptions, preference defaults, server-side scheduling,
opening and deadline reminders, date-change notices, deep links, deduplication, retry
behavior, revoked-endpoint cleanup and notification history.

**Exit:** a reminder is delivered once, uses wording matching the date status and opens
the correct program.

## Phase 4 — Seed data and reliability

Import approximately 20 universities and 40–60 programs with official sources, approved
logos or monograms, verified public statuses and tests for conflicts, old intakes,
multiple rounds and date changes.

**Exit:** every seeded date has a source and verification state; quality gaps are reported.

## Phase 5 — Integration and launch readiness

Validate end-to-end journeys, production migrations, backups, observability, dependency
security, accessibility, performance, PWA icon quality and the final launch checklist.

**Exit:** all MVP success conditions are validated and no P0/P1 launch blocker remains.

## Buffer

Reserve explicit stabilization capacity for iOS PWA behavior, push delivery, university
site changes, migration fixes, data cleanup and visual polish.

## Dependency order

```text
Scaffold
  -> contracts + database + mocks + tokens
  -> frontend and API
  -> shared enrichment
  -> notifications
  -> verified seed data
  -> launch validation
```

## Working rules

- One feature branch and pull request per issue or tightly related issue group.
- No direct feature pushes to `main`.
- Contracts are frozen after Phase 0; later changes require `contract-change`.
- Migrations require the `migration` label and explicit review.
- Seed data changes must remain small and source-backed.
- Each issue declares its allowed file paths.
- User-facing content never exposes confidence numbers, scraping, workers or AI terms.

The complete implementation backlog is maintained in
[GitHub issues](https://github.com/aminssutt/athenvia/issues) and organized in the
[Athenvia Roadmap GitHub Project](https://github.com/users/aminssutt/projects/5).
