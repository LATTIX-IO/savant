---
name: lattix-pr
description: Draft a Lattix-standard pull request body
argument-hint: "<branch, diff, or change summary>"
agent: ask
---

Create a Lattix PR body from the current changes.

Use this format:
## Problem
## Approach
## Tradeoffs
## Test Evidence
## Security/Privacy
## Observability
## Docs/Config
## Rollout
## Rollback
## Risks
## Checklist
- [ ] Tests added/updated
- [ ] Lint, format, and types pass
- [ ] Inputs validated and auth checked
- [ ] No secrets, PII, or sensitive logs
- [ ] Observability updated where relevant
- [ ] Docs/ADR/runbook updated where relevant
- [ ] Rollout and rollback documented

Be concise. Do not invent test results; mark unknowns as TODO.