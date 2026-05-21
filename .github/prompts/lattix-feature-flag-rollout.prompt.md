---
name: lattix-feature-flag-rollout
description: Design a safe Lattix feature flag rollout and rollback plan
argument-hint: "<feature, diff, service, endpoint, or migration>"
agent: ask
---

Create a Lattix feature flag rollout plan.

Include:
- Flag name and owner.
- Default state and environments.
- Targeting rules.
- Dependencies and prerequisites.
- Rollout stages: dev, staging, internal, canary, partial, full.
- Success metrics: latency, errors, throughput, business or UX metrics.
- Guardrails: alerts, dashboards, logs, traces.
- Kill switch behavior.
- Rollback and roll-forward steps.
- Data migration or compatibility concerns.
- Cleanup plan for removing the flag.

Rules:
- Default to safe/off unless explicitly justified.
- Avoid unsafe exposure of beta or admin functionality.
- Do not invent metrics or dashboards; mark unknowns as TODO.

Return:
## Flag
## Rollout Plan
## Monitoring
## Kill Switch
## Rollback
## Compatibility
## Cleanup
## Open Questions