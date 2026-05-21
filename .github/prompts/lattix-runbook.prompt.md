---
name: lattix-runbook
description: Create or update an operational runbook for a Lattix service, job, or workflow
argument-hint: "<service, job, alert, endpoint, or operational scenario>"
agent: ask
---

Create a Lattix operational runbook.

Include:
- Purpose and owner.
- Service/job dependencies.
- Normal behavior and SLO/SLA if known.
- Alerts and symptoms.
- Triage steps.
- Dashboards, logs, metrics, traces, and health checks.
- Safe remediation steps.
- Rollback or roll-forward.
- Escalation path.
- Customer/user impact.
- Data/privacy considerations.
- Post-incident follow-up.

Rules:
- Prefer safe, reversible actions.
- Mark destructive actions clearly.
- Include dry-run guidance where relevant.
- Do not include secrets, tokens, or private credentials.
- Do not invent dashboards or commands; mark unknowns as TODO.

Return a concise runbook in Markdown.