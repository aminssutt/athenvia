# Athenvia

> Find a program. Follow it. Athenvia reminds you at the right time.

Athenvia is a mobile-first university application tracking PWA. Students can find Master,
MBA and PhD programs, understand whether application dates are confirmed or expected,
follow the programs that matter to them, and receive timely reminders.

## Repository

This repository is a pnpm TypeScript monorepo:

```text
apps/web           Next.js application and PWA
apps/worker        BullMQ background worker
packages/database  Prisma schema and PostgreSQL client
packages/contracts Shared Zod schemas, domain types and mocks
packages/ui        Design tokens and reusable UI foundations
packages/config    Shared TypeScript configuration
data/seed          Source-backed seed data
docs               Product, architecture and operations documentation
scripts            Import and maintenance scripts
```

## Quick start

Prerequisites: Node.js 22+, pnpm 11+, Docker.

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm dev
```

The web application runs at <http://localhost:3000>. See
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) for the full setup.

## Product rules

- Never present an estimate as an official date.
- Every published application date links to an official source when available.
- Private watchlists, notes and push subscriptions are isolated per user.
- Notification permission is requested only after a student follows a program.
- Technical extraction and verification details remain invisible in the student interface.

## Roadmap

The implementation plan is maintained in [`docs/ROADMAP.md`](docs/ROADMAP.md) and mirrored
to the [Athenvia Roadmap Project](https://github.com/users/aminssutt/projects/5) and
[GitHub issues](https://github.com/aminssutt/athenvia/issues).
