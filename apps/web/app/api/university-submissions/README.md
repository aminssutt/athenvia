# University submission API

`POST /api/university-submissions` stores a private, authenticated suggestion in
`university_submissions` with status `PENDING`.

```json
{
  "universityName": "National University of Singapore",
  "country": "Singapore",
  "officialWebsite": "https://nus.edu.sg/"
}
```

`officialWebsite` may be `null` or omitted. A successful request returns status
`201`:

```json
{
  "status": "pending_review",
  "submissionId": "a58be0c4-9abe-44bd-aed1-388eb603b939"
}
```

The endpoint requires an Auth.js database session. It resolves the session email
to the owning user ID and never accepts an owner ID from the request.

## Limits and errors

Each authenticated user may make five attempts per hour and each client address
twenty. Redis applies the shared atomic limit. A bounded in-process limiter is
used if Redis is not configured or temporarily unavailable.

Responses use `Cache-Control: no-store` and structured errors. Expected status
codes include `400`, `401`, `403`, `413`, `415`, `429` and `503`.

## URL security boundary

Submitted websites accept only HTTP(S), domain hostnames and standard ports.
Credentials, literal IP addresses and internal hostname suffixes are rejected.
The hostname is resolved twice; every IPv4 and IPv6 result must be globally
routable. Mixed public/private responses are rejected.

This endpoint validates and stores a URL but never fetches it. Any future source
fetcher must resolve again immediately before connecting, reject private
addresses again, pin the validated address for the connection, validate every
redirect target and prevent DNS rebinding between validation and connection.

Run the permanent API tests with:

```sh
pnpm --filter @athenvia/web exec vitest run \
  --config app/api/university-submissions/vitest.config.ts
```

Optional local smokes:

```sh
DATABASE_URL=postgresql://... pnpm --filter @athenvia/database test:submission-smoke
REDIS_URL=redis://localhost:6379 pnpm --filter @athenvia/database exec tsx \
  ../../apps/web/app/api/university-submissions/redis-smoke.ts
```
