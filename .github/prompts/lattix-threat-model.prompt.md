---
name: lattix-threat-model
description: Create a lightweight threat model for a Lattix feature or change
argument-hint: "<feature, diff, design, endpoint, job, or data flow>"
agent: ask
---

Create a lightweight Lattix threat model.

Focus on:
- Assets: data, secrets, identities, services, permissions.
- Trust boundaries: user input, APIs, DB, queues, files, vendors, cloud.
- Entry points and abuse paths.
- Authn/authz assumptions and fail-closed behavior.
- Input validation by type, length, range, format, and authorization context.
- Injection risks: SQL, shell, path, SSRF, template, deserialization.
- Sensitive data risks: PII, secrets, tokens, auth headers, logs, traces, exports.
- Least privilege for DB, cloud, filesystem, network, and service accounts.
- Availability risks: retries, rate limits, queue growth, timeouts, saturation.
- Rollout, monitoring, kill switch, and rollback.

Return:
## Summary
## Assumptions
## Data Flow
## Assets
## Trust Boundaries
## Threats
Use severity: Critical, High, Medium, Low.
## Mitigations
## Required Tests
## Observability
## Open Questions

Do not invent facts. Mark unknowns as TODO.