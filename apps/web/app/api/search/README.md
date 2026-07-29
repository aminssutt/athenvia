# Catalogue search API

`GET /api/search` searches active programs and returns each matching program
with its university and domain names.

## Query parameters

| Parameter | Required | Rules                                           | Example                                      |
| --------- | -------- | ----------------------------------------------- | -------------------------------------------- |
| `query`   | Yes      | Trimmed, 2–120 characters                       | `NUS`, `École Polytechnique`, `data science` |
| `domain`  | No       | Exact domain slug or name, 1–80 characters      | `computer-science`                           |
| `cursor`  | No       | Opaque cursor returned by the previous response | `eyJvZmZzZXQiOjIwfQ`                         |

University aliases, university names, program names, domain names and common
misspellings are matched accent-insensitively. Results are ranked
deterministically. A page contains at most 20 programs.

## Success response

Status `200` follows `SearchResponseSchema`:

```json
{
  "programs": [
    {
      "id": "0f043d91-d700-4ee1-8f66-9a65c7e59301",
      "university": {
        "id": "c9502eb6-819b-4723-9a17-d503555eaead",
        "name": "National University of Singapore",
        "countryCode": "SG",
        "city": "Singapore",
        "logoUrl": null
      },
      "name": "MSc Venture Creation",
      "degreeType": "MASTER",
      "domains": ["Entrepreneurship"],
      "location": "Singapore",
      "durationMonths": 12,
      "intakeLabel": "August 2027",
      "nextWindow": null
    }
  ],
  "nextCursor": null
}
```

Pass a non-null `nextCursor` unchanged to retrieve the next page. Cursors are
opaque, query-specific client state; restart from the first page if the API
returns `INVALID_CURSOR`.

## Errors and limits

Errors follow `SearchErrorResponseSchema`.

| Status | Code                 | Meaning                                                       |
| ------ | -------------------- | ------------------------------------------------------------- |
| `400`  | `INVALID_REQUEST`    | Query, domain or cursor does not follow the shared contract   |
| `400`  | `INVALID_CURSOR`     | Cursor is malformed or outside the supported pagination range |
| `429`  | `RATE_LIMITED`       | The anonymous client exceeded 30 searches per minute          |
| `503`  | `SEARCH_UNAVAILABLE` | PostgreSQL or another search dependency is unavailable        |

Every response includes `RateLimit-Limit`, `RateLimit-Remaining` and
`RateLimit-Reset`. A `429` or retryable `503` also includes `Retry-After`.
Responses use `Cache-Control: no-store`.
