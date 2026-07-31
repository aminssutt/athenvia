# Launch checklist

Ticket: [P5-14] Complete the launch checklist (#105). Status recorded on
2026-07-31. Every line links to the evidence that closed it.

## MVP success conditions

| Condition                                                              | Status                   | Evidence                                                                                       |
| ---------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------- |
| Catalogue live: ~20 universities, 40–60 source-backed programmes       | ✅ 21 / 51               | #85, `docs/data/data-quality-report.md`                                                        |
| Every programme has an official summary and source                     | ✅ 51/51                 | Data-quality report (100% coverage, all official)                                              |
| Canonical URLs verified, no third-party aggregators                    | ✅ 166 URLs              | #86 closing comment                                                                            |
| Core journey works: first launch → search → detail → Follow            | ✅                       | #93, `docs/quality/launch-test-passes.md`, 45/45 e2e                                           |
| Install journey: Safari guidance, standalone routing, desktop fallback | ✅ (device pass pending) | #92, launch-test-passes report                                                                 |
| Web Push opt-in only after explicit action; delivery exactly once      | ✅ (device pass pending) | #94; worker delivery suite                                                                     |
| Community contribution: submit → review → approve → reuse              | ✅                       | #95 (form transport fixed after the P0 pass caught it)                                         |
| Date integrity: no invented dates, conflicts blocked from publication  | ✅                       | Seed rules; #88/#89/#90 worker test suites                                                     |
| Accessibility: WCAG 2.2 AA review, no blocking defect                  | ✅                       | #101 review + #190 fixes, 17 a11y e2e tests                                                    |
| Performance: mobile budget met on all routes                           | ✅ ≤ 100.3 kB gz         | #102, `docs/quality/performance-budget.md`                                                     |
| PWA offline: service worker installs in production                     | ✅                       | Fix #199, proven against a production build                                                    |
| Security: launch review with zero P0/P1 findings                       | ✅                       | #100 review; P2/P3 findings fixed in #192                                                      |
| Dependencies: zero known high/critical advisories                      | ✅                       | #104 scanning + #188 remediation (`pnpm audit --prod` clean)                                   |
| Observability: structured logs, request correlation, uptime checks     | ✅                       | #99, `docs/operations/observability.md`                                                        |
| Production stack boots end to end (migrate + seed + healthchecks)      | ✅                       | Full local prod-compose smoke: all healthy, health 200, worker heartbeat 200, catalogue served |

## Remaining non-blocking items (accepted for launch)

- **University logos and home-screen icon set** (#87, #103): needs design assets
  from the owner. The UI renders monogram fallbacks; the data-quality report
  tracks the 0/21 logo coverage.
- **Physical-device passes** (#63, and the device remainders of #92/#94):
  install from the real iOS Share sheet, real push receipt and tap-through,
  magic link on a real mailbox. Owner-executed after deployment.
- **Automated source-refresh pipeline is intentionally not wired** for the MVP
  (documented in `apps/worker/src/notifications/README.md`): dates ship via
  seeds and admin moderation. The primitives (conflict blocking, dedup,
  reminder recalculation) are implemented and tested. Product decision recorded
  2026-07-31: launch as-is, wire post-launch.
- **Prisma 7 major upgrade** deferred (Dependabot PR #174 open with rationale);
  the transitive `effect` advisory is already remediated by an override.

## Operational prerequisites

- [x] `docker-compose.prod.yml` production-grade: private network, expose-only,
      healthchecks, `no-new-privileges`, secrets never build args
- [x] Migration runbook: `docs/operations/` (added by #162)
- [x] Backups configured and restoration drilled (#163)
- [x] Dependency scanning + weekly audit + response policy (#104)
- [x] Environment template complete: `.env.example` (incl. all rate-limit salts)
- [x] Uptime checks documented: `GET /api/health` (web+deps) and
      `GET /api/health/worker` (worker heartbeat), both verified on the prod
      smoke stack

## Rollback

1. Dokploy: redeploy the previous `ATHENVIA_IMAGE_TAG` (images are tagged per
   release; the compose reads the tag from the environment).
2. Database: migrations are additive for this release; if a rollback crosses a
   migration boundary, restore from the latest backup per the restoration
   drill runbook (#163) before redeploying the older tag.
3. Seed data: imports are idempotent and never prune — re-running an older
   seed set cannot delete records; no data rollback is needed for catalogue
   changes.

## Ownership and support

- **Owner / admin**: the address in `ATHENVIA_ADMIN_EMAILS` (moderation UI at
  `/admin`, gated by allowlist + session).
- **Alerts**: Dependabot security alerts + weekly `dependency-audit` workflow
  failures land on the repository; uptime monitors should target the two
  health endpoints (see `docs/operations/observability.md` for alert
  recommendations).
- **Support path**: a user-reported issue should include the `x-request-id`
  response header value; logs correlate on it without exposing any account
  identifier.
