---
name: lattix-migration
description: Design or review an idempotent Lattix migration or data script
argument-hint: "<migration goal>"
agent: agent
---

Design or review a Lattix migration/script.

Requirements:
- Must be repeatable, idempotent, observable, and safe to rerun.
- Include rollback or roll-forward steps.
- Prefer dry-run mode for destructive or large-scale operations.
- Batch large changes; note locks, runtime, failure behavior, and retry strategy.
- Validate inputs and permissions.
- Avoid logging sensitive data.
- Include tests or verification queries.
- Include metrics/logs for progress and failures when relevant.

Return:
Plan; target files; migration/script; verification; rollback/roll-forward; operational risks.