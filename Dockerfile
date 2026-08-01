# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base

ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable \
  && corepack prepare pnpm@11.18.0 --activate

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM dependencies AS build

ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ARG NEXT_PUBLIC_ATHENVIA_DEPLOYMENT_ID=docker

ENV NEXT_PUBLIC_APP_URL="${NEXT_PUBLIC_APP_URL}"
ENV NEXT_PUBLIC_ATHENVIA_DEPLOYMENT_ID="${NEXT_PUBLIC_ATHENVIA_DEPLOYMENT_ID}"

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

COPY . .

RUN pnpm --filter @athenvia/database db:generate \
  && pnpm build

FROM node:22-bookworm-slim AS web

ENV HOSTNAME=0.0.0.0
ENV NODE_ENV=production
ENV PORT=3000

RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((response) => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1))"]

CMD ["node", "apps/web/server.js"]

FROM dependencies AS worker-dependencies

# Recreate a production-only workspace from the lockfile. This keeps browser and
# test tooling out of the runtime image without resolving dependency versions
# again; retries make transient registry failures harmless during remote builds.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  apt-get update \
  && apt-get install --yes --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/* \
  && rm -rf node_modules apps/*/node_modules packages/*/node_modules \
  && pnpm install --prod --frozen-lockfile --filter @athenvia/worker... \
    --fetch-retries=5 \
    --fetch-retry-mintimeout=1000 \
    --fetch-retry-maxtimeout=10000

FROM worker-dependencies AS worker-package

COPY apps/worker/src ./apps/worker/src
COPY packages/contracts ./packages/contracts
COPY packages/database ./packages/database

RUN pnpm --filter @athenvia/database db:generate

FROM node:22-bookworm-slim AS worker

ENV NODE_ENV=production

# unzip is for the registry import, which is run by an operator from this
# container and extracts a zip archive GNU tar cannot read. Keeping it here
# rather than in the migrate stage is what lets that import run from the
# long-lived worker container, without a shell on the Docker host.
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ca-certificates openssl unzip \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=worker-package --chown=node:node /app ./

# Snapshot storage is a mount point, and Docker seeds a fresh named volume from
# the image directory it covers. Creating it here as node:node is what makes the
# volume writable by the unprivileged runtime user.
RUN mkdir -p /app/data/snapshots && chown -R node:node /app/data

USER node

CMD ["./apps/worker/node_modules/.bin/tsx", "apps/worker/src/index.ts"]

FROM worker AS migrate

ENV NODE_ENV=production

COPY --chown=node:node data/seed ./data/seed

CMD ["./packages/database/node_modules/.bin/prisma", "migrate", "deploy", "--schema=packages/database/prisma/schema.prisma"]
