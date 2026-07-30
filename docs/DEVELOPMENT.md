# Local development

## Requirements

- Node.js 22 or newer
- pnpm 11 or newer
- Docker with Compose

## Setup

1. Copy `.env.example` to the root `.env` and replace its placeholders.
2. Start PostgreSQL and Redis with `docker compose up -d`.
3. Install dependencies with `pnpm install`.
4. Generate Prisma Client with `pnpm db:generate`.
5. Apply migrations with `pnpm db:migrate`.
6. Import the catalogue with `pnpm db:seed`.
7. Start web and worker with `pnpm dev`.

Use `pnpm dev:web` when only the mocked frontend is needed.

The root commands load `.env` before they start a package. `DATABASE_URL` and
`REDIS_URL` are derived from the PostgreSQL and Redis values for local host
access, so package-level `.env` files are not needed.

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

The production-shaped Docker and Dokploy flow is documented in
[`DEPLOYMENT.md`](./DEPLOYMENT.md).
