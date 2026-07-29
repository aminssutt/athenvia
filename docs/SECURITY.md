# Security and privacy baseline

- Validate public input using shared Zod contracts.
- Apply rate limits to search, submissions, authentication and push endpoints.
- Protect state-changing browser requests against CSRF where relevant.
- Never fetch arbitrary user URLs directly.
- Resolve and reject loopback, link-local and private network targets before retrieval.
- Restrict retrieval to approved official university domains.
- Sanitize stored HTML and extracted text.
- Keep watchlists, notes, subscriptions and notification history scoped to their owner.
- Never include email addresses, push endpoints or secrets in application logs.
- Support unsubscribe, subscription revocation and account deletion.
- Collect the minimum personal data required for the product.

Security-sensitive changes receive the `security` label and explicit review.
