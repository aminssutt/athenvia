# Contributing

## Branches

Create one branch per issue:

```text
agent/<issue-number>-<short-description>
```

Open a pull request into `main`. Database migrations and shared contract changes require
explicit review and the corresponding `migration` or `contract-change` label.

## Scope

Each issue lists the files it is allowed to modify. Keep seed changes small and include
official source provenance. Coordinate before changing shared UI components or frozen
contracts.

## Checks

Run before opening a pull request:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
