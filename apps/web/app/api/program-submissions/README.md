# Program submission API

`POST /api/program-submissions` stores an authenticated suggestion for an
existing active university. The server derives the owner and `PENDING` status;
neither can be supplied by the client.

The JSON body matches the missing-program form boundary:

```json
{
  "universityId": "03a8d733-1bb6-49c6-b3dc-4cd4216300c3",
  "universityName": "Example University",
  "programName": "MSc Responsible AI",
  "degreeType": "MASTER",
  "domain": "Artificial intelligence",
  "officialUrl": "https://example.edu/responsible-ai"
}
```

The URL is only normalized and validated as HTTP(S). This endpoint deliberately
does not fetch it, resolve its host, or claim that it is official; verification
belongs to the review worker.

Cookie-authenticated requests require a same-origin `Origin` header. Successful
responses use status `201`:

```json
{
  "status": "pending_review",
  "submissionId": "25507674-5e07-4b18-9715-05ee25ef0a14"
}
```

The endpoint is limited to five attempts per authenticated user every ten
minutes. Redis coordinates the counter between instances; a bounded in-process
counter remains active if Redis is unavailable.
