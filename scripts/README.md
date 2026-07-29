# Maintenance scripts

One-off import, verification and maintenance scripts live here. Scripts must be
idempotent where practical, validate inputs, avoid arbitrary network targets and provide
a dry-run mode before changing shared catalogue data.

## GitHub roadmap automation

- `create-roadmap-issues.ps1` creates the approved issue catalogue idempotently and closes
  the Phase 0 items delivered by the bootstrap.
- `configure-roadmap-project.ps1` adds every issue to the GitHub Project and synchronizes
  Status, Priority, Phase, Workstream, Owner, target milestone and dependency fields.
