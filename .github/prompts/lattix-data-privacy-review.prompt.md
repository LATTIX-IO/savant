---
name: lattix-data-privacy-review
description: Review Lattix changes for PII, retention, access, logging, and privacy risk
argument-hint: "<feature, diff, schema, endpoint, event, export, or data flow>"
agent: agent
---

Perform a Lattix data privacy review.

Check:
- What data is collected, processed, stored, logged, exported, or shared.
- PII, sensitive data, secrets, tokens, auth headers, session IDs.
- Purpose limitation and data minimization.
- Access control and least privilege.
- Retention, deletion, and backup behavior.
- Encryption in transit and at rest where relevant.
- Logs, metrics, traces, analytics, and support tooling.
- Vendor/third-party sharing.
- User consent or notice requirements if applicable.
- Test fixtures and docs for accidental sensitive data.

Rules:
- Never output real PII or secrets.
- Recommend masking/redaction/tokenization where needed.
- Mark legal/compliance uncertainty for human review.

Return:
## Summary
## Data Inventory
## Privacy Risks
## Required Mitigations
## Logging/Telemetry Review
## Retention/Deletion Notes
## Tests
## Human Review Needed