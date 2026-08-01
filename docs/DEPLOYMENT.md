# Deployment architecture

Athenvia is deployed as a portable Docker Compose stack. Dokploy is the first
orchestrator, but the images and Compose file do not depend on a Dokploy-only
runtime.

## Services and boundaries

| Service    | Role                                                                 | Public ingress                         | Persistent data |
| ---------- | -------------------------------------------------------------------- | -------------------------------------- | --------------- |
| `web`      | Next.js UI, API and authentication                                   | Port 3000 through Dokploy/Traefik only | None            |
| `worker`   | BullMQ reminders and Web Push delivery                               | None                                   | None            |
| `migrate`  | Runs Prisma migrations and the idempotent catalogue seed, then exits | None                                   | None            |
| `postgres` | Catalogue, accounts, sessions, subscriptions and job state           | None                                   | `postgres_data` |
| `redis`    | BullMQ and rate limiting                                             | None                                   | `redis_data`    |

All services share the private `backend` bridge network. Only `web` declares an
application port. PostgreSQL and Redis use `expose`, not host-published ports.
The web and worker containers start only after Redis is healthy and `migrate`
has completed successfully.

The web health endpoint is `GET /api/health`. It returns `200` only when the
process can reach both PostgreSQL and Redis. It never returns connection details
or secret values.

Playwright and browser binaries are development/test tooling only. The
production worker image contains neither the Playwright package nor Chromium;
the optional browser fallback is therefore intentionally unavailable in
production.

## One environment file

Copy `.env.example` to the untracked root `.env` and keep all local deployment
configuration there. Root development commands load this file through
`scripts/with-env.mjs`; Docker Compose uses it for interpolation. Existing
package-level environment files are not required once the root file is filled.

In Dokploy, enter the same key/value set in the Compose service Environment
screen. Do not add `COMPOSE_PROJECT_NAME`: Dokploy owns the Compose project name
and uses it to isolate environments. Do not commit or upload `.env` to Git.
Dokploy makes the other values available when it renders the stack.

Secrets are mapped by service:

- `web` receives authentication, Google, public VAPID and rate-limit settings.
- `worker` receives the complete VAPID pair.
- `migrate` receives only the database connection.
- PostgreSQL and Redis receive only their own credentials.

`VAPID_PRIVATE_KEY`, `GOOGLE_CLIENT_SECRET`, `AUTH_SECRET`, database passwords
and mail credentials are never Docker build arguments and are not baked into an
image.

## Required production values

### Deployment and ownership

- `ATHENVIA_IMAGE_TAG`: a release identifier, normally a short Git SHA.
- `APP_URL`: the final HTTPS origin without a trailing slash.
- `ATHENVIA_ADMIN_EMAILS`: comma-separated emails allowed to use moderation
  endpoints.

### Infrastructure secrets

- `POSTGRES_DB`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`: use only letters, numbers, `_` and `-`, because Compose
  builds the internal database URL from this value.
- `REDIS_PASSWORD`: use the same URL-safe character rule.
- `AUTH_SECRET`: at least 32 random bytes.

Generate independent URL-safe values with:

```bash
openssl rand -hex 32
```

Run the command three times for PostgreSQL, Redis and Auth.js. Never reuse one
secret for another service.

### Authentication email

- `AUTH_EMAIL_FROM`: a sender authorized by the mail provider.
- Configure one of:
  - `AUTH_RESEND_API_KEY`, or
  - `AUTH_EMAIL_SERVER`, as an SMTP URL.

Email magic links fall back to a local SMTP address when neither is configured,
which is not suitable for production.

### Google OAuth

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`

Configure this authorized redirect URI in Google Cloud:

```text
https://YOUR_DOMAIN/api/auth/callback/google
```

Both Google values must be present or the Google button remains disabled.

### Web Push

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`, normally `mailto:admin@YOUR_DOMAIN`

The public and private values must be one matching P-256 pair. Generate a pair
with:

```bash
pnpm vapid:generate
```

Changing the pair after users subscribe invalidates existing push
subscriptions.

The three dedicated rate-limit salts are optional because `AUTH_SECRET` is the
fallback. They can be independently generated later for easier secret
rotation.

### Verification pipeline

All four values are optional and have working defaults; only the Gemini key
changes behaviour.

- `SOURCE_RECHECK_DAYS` (default `7`): an official programme source is
  re-fetched once its last check is older than this.
- `SOURCE_RECHECK_BATCH` (default `25`): politeness cap on how many sources one
  sweep enqueues. The sweep runs every six hours.
- `GEMINI_API_KEY`: enables the citation-constrained extraction pass. Without
  it the pipeline stays fully deterministic and nothing else changes.
- `GEMINI_MODEL` (default `gemini-2.5-flash`).

`SNAPSHOT_STORAGE_DIR` is set by Compose to `/app/data/snapshots` and must not
be overridden: it is the mount point of the `snapshot_data` volume. Immutable
source snapshots are content-addressed files there, and `source_snapshots` rows
reference them by storage key. Losing the volume while keeping the database
leaves rows pointing at missing bytes, and every later parse job for those
snapshots fails.

## Dokploy deployment

Dokploy uses its own Compose file, `docker-compose.dokploy.yml`, not
`docker-compose.prod.yml`. The two describe the same stack; the Dokploy variant
drops four things that a Dokploy deployment cannot tolerate, each of which was
observed to fail in practice:

| Dropped                                    | Why                                                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The private `backend` network              | Traefik routes through the shared `dokploy-network` it attaches itself. A service that only lives on a private bridge is unreachable, and its domain never resolves.                                                                                         |
| `image:` on the built services             | With an image name set, a deploy that does not pass `--build` tries to pull `athenvia-web:<tag>` from a registry where it does not exist. Only the pullable services (PostgreSQL, Redis) then start — the classic "only postgres and redis show up" symptom. |
| YAML anchors and `x-` extension fields     | Valid Compose, but not every renderer in the chain handles merge keys, and a parse failure is silent.                                                                                                                                                        |
| `${VAR:?message}` required-variable syntax | Same reason: it aborts the whole render when a variable is missing, with no useful surfacing.                                                                                                                                                                |

`web` and `worker` therefore reach the datastores through the
`athenvia-postgres` and `athenvia-redis` network aliases rather than the bare
`postgres` / `redis` service names, which are the most collision-prone names on
a network shared with other Dokploy applications.

`docker-compose.prod.yml` stays the reference for a plain Docker host, where the
private network and pinned image tags are the better setup.

1. Create a project and production environment in Dokploy.
2. Add a **Docker Compose** service from the Git repository.
3. Select the `main` branch and set the Compose path to
   `docker-compose.dokploy.yml`.
4. Paste the root `.env` key/value set into the service Environment screen.
5. In Dokploy's **Domains** screen, add the HTTPS domain to service `web`, port
   `3000`. Do not add manual Traefik labels and do not add domains to PostgreSQL,
   Redis, worker or migrate.
6. Deploy after saving the domain. The expected order is PostgreSQL/Redis
   health, migrations and seed, then web and worker. Redeploy whenever the
   domain configuration changes.
7. Verify `https://YOUR_DOMAIN/api/health`, the sign-in page, the worker logs
   and one push subscription.
8. Import the university registry once, as described below. Until it runs, the
   catalogue contains only the curated seed universities.

### Importing the ROR university catalogue

The registry import is deliberately **not** part of the `migrate` one-shot. It
downloads a ~35 MB archive and parses a ~300 MB JSON document, which needs
roughly 2.5 GB of free memory; running that on every deploy would put an
avoidable OOM risk on the deployment path. It is idempotent, so it is run
manually once and again only when adopting a fresher registry release.

From a shell on the host, against the deployed stack:

```bash
docker compose -f docker-compose.dokploy.yml run --rm \
  -e NODE_OPTIONS=--max-old-space-size=3072 \
  migrate ./packages/database/node_modules/.bin/tsx packages/database/src/ror.ts
```

Add `--dry-run` first to validate the mapping without writing. The command
reports how many universities, aliases and registry sources it created; a
second run reports zero created rows.

If the host has less than about 3 GB free, restrict the scope instead of
importing the whole registry, for example
`packages/database/src/ror.ts --countries FR,GB,DE,SG,US`.

Dokploy's native domain configuration should manage TLS and Traefik routing:

- <https://docs.dokploy.com/docs/core/docker-compose/example>
- <https://docs.dokploy.com/docs/core/docker-compose/domains>
- <https://docs.dokploy.com/docs/core/variables>

## Local container verification

Render the production configuration without revealing its values:

```bash
docker compose -f docker-compose.prod.yml config --quiet
```

Build and start the full production-shaped stack:

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml exec web \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(async r => { console.log(r.status, await r.text()); process.exit(r.ok ? 0 : 1) })"
```

Stop containers without deleting the named database and Redis volumes:

```bash
docker compose -f docker-compose.prod.yml down
```

Never add `--volumes` to the production shutdown command.

## Release, backup and rollback

Before the first public launch, configure off-server PostgreSQL backups and
complete a restore drill. Named Docker volumes survive ordinary redeployments
but are not backups.

For each release:

1. Back up PostgreSQL before a migration that can remove or transform data.
2. Use an immutable Git SHA for `ATHENVIA_IMAGE_TAG`.
3. Deploy and confirm the migration container exits `0`.
4. Confirm `/api/health`, authentication, catalogue search and worker startup.

For an application-only regression, redeploy the previous Git SHA. Database
migrations are forward-only: do not run `prisma migrate reset` or an automatic
down migration in production. If a schema change must be reverted, prepare and
review a forward repair migration or restore the verified pre-deploy backup.
