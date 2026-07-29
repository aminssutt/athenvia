# Local development

## Requirements

- Node.js 22 or newer
- pnpm 11 or newer
- Docker with Compose

## Setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL and Redis with `docker compose up -d`.
3. Install dependencies with `pnpm install`.
4. Generate Prisma Client with `pnpm db:generate`.
5. Apply migrations with `pnpm db:migrate`.
6. Start web and worker with `pnpm dev`.

Use `pnpm dev:web` when only the mocked frontend is needed.

## Required checks

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Environment safety

Do not commit `.env` or real VAPID, authentication, database or SMTP credentials. The
example file contains placeholders only.
