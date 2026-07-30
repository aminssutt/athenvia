# VAPID key operations

VAPID identifies Athenvia's application server when it sends Web Push
notifications. Each environment uses one matching P-256 public/private key pair
and a contact subject:

- `VAPID_PUBLIC_KEY`: public application-server key;
- `VAPID_PRIVATE_KEY`: server-only signing key;
- `VAPID_SUBJECT`: an HTTPS contact URL or `mailto:` address.

The worker validates all three values and verifies that the public and private
keys form a pair when it starts. Invalid or missing configuration stops worker
startup without printing key material. The loaded private-key property is
non-enumerable so ordinary object serialization and structured logging do not
include it; callers must still never log it explicitly.

The browser does not receive environment variables directly. It reads only the
public key from `GET /api/push/vapid-public-key`. That route has no reference to
`VAPID_PRIVATE_KEY` and returns `no-store` responses.

## Generate a pair

Run this in a trusted administrative terminal:

```bash
pnpm vapid:generate
```

The command prints a new public and private key. Do not redirect its output into
the repository, paste it into tickets or chat, or save it in shell history when
the terminal records pasted commands.

1. Put the private key directly into the environment's secret manager as
   `VAPID_PRIVATE_KEY`.
2. Put the matching public key in the web and worker runtime configuration as
   `VAPID_PUBLIC_KEY`.
3. Set `VAPID_SUBJECT` to a monitored `mailto:` address or HTTPS contact page.
4. Restart the web and worker deployments. A worker that rejects the pair must
   not be forced to start.
5. Fetch `/api/push/vapid-public-key` and confirm it returns the expected public
   key. Never inspect or print the private key as part of a health check.

Do not use the placeholders from `.env.example` as credentials.

## Environment isolation

Generate independent pairs for local development, preview/staging and
production. Never copy the production private key to developer machines,
preview deployments, CI logs or client-visible `NEXT_PUBLIC_*` variables.

Both web and worker deployments must receive the same public key. Only the
worker or another server-side push sender receives the private key. Access to
production secret values should be limited to deployment administrators and
the notification runtime.

## Planned rotation

A push subscription is associated with the public application-server key used
when the browser created it. Changing the pair therefore requires clients to
subscribe again; replacing only one half of the pair breaks delivery.

1. Record the rotation owner, reason, maintenance window and rollback deadline.
2. Preserve the current pair in versioned secret-manager history. Never export
   it to a local file.
3. Generate and store a new pair under a new secret version.
4. Deploy the matching new public key to web and worker together.
5. Revoke existing stored push subscriptions and prompt active clients to
   subscribe with the new public key.
6. Send a canary notification, then monitor subscription and delivery failures.
7. Retire access to the old private key only after the rollback window and
   re-subscription target have passed.

Athenvia currently supports one active VAPID pair. A zero-downtime rotation
would require subscriptions to carry a key version and the sender to retain
both key pairs during migration; do not claim zero downtime until that support
exists.

## Rollback

If delivery or subscription creation fails after rotation:

1. restore the exact previous public key, private key and subject from secret
   manager history;
2. redeploy/restart web and worker together;
3. verify that the public endpoint exposes the restored public key;
4. revoke subscriptions created with the failed replacement key so those
   clients subscribe again;
5. keep the failed pair isolated for incident analysis, then destroy it after
   the incident and audit windows close.

Never mix the old public key with the new private key. Startup validation is
expected to reject that configuration.
