# Dependency security scanning

Automated scanning keeps vulnerable dependencies out of the codebase and
surfaces known advisories in packages already in use.

## What runs and when

| Scan                       | Trigger                                 | Scope                                            | Failure condition                        |
| -------------------------- | --------------------------------------- | ------------------------------------------------ | ---------------------------------------- |
| Dependabot version updates | Weekly (Monday 06:00 UTC)               | npm packages (pnpm workspace) and GitHub Actions | Opens PRs, never fails builds            |
| Dependabot security alerts | Continuous (GitHub advisory database)   | All manifests and lockfiles                      | Raises repository security alerts        |
| `dependency-review.yml`    | Every pull request                      | Dependencies added or changed by the PR diff     | Fails on `high` or `critical` advisories |
| `dependency-audit.yml`     | Weekly (Monday 06:00 UTC) and on demand | Production dependencies in `pnpm-lock.yaml`      | Fails on `critical` advisories           |

The scheduled audit runs `pnpm audit --prod --audit-level critical` with the
same pnpm and Node versions as CI (`pnpm/action-setup` reading `packageManager`
from `package.json`, Node 22).

## Alert response policy

| Severity      | First response    | Patch or mitigation   |
| ------------- | ----------------- | --------------------- |
| Critical      | Within 24 hours   | Within 72 hours       |
| High          | Within 1 week     | Within 1 week         |
| Moderate, low | Next update cycle | Next Dependabot cycle |

Response steps for critical and high alerts:

1. Confirm the advisory applies to a reachable code path (not only a
   dev-time or unused transitive dependency).
2. Upgrade to a patched version through a pull request. If no patch exists,
   apply a pnpm override or remove the affected feature, and record the
   decision in the PR description.
3. If neither is possible within the deadline, document the accepted risk
   and a follow-up issue with the `security` label.

## Triage ownership

The repository owner (see `.github/CODEOWNERS`) triages Dependabot alerts,
failed dependency-review checks and scheduled audit failures. Alerts are
reviewed at least weekly, when the scheduled audit reports.

## Lockfile update rules

- Every dependency update, including Dependabot PRs, goes through a pull
  request with green CI and human review. Auto-merge is not enabled.
- `pnpm-lock.yaml` changes are never pushed directly to `main`; CI installs
  with `--frozen-lockfile`, so the lockfile must stay consistent with the
  manifests.
- Review of a lockfile PR checks the changelog or release notes of the
  updated packages and confirms no unexpected new packages or maintainers
  appear in the diff.
- Security-sensitive updates (auth, crypto, parsers of untrusted input)
  receive the `security` label and explicit review, per `docs/SECURITY.md`.
