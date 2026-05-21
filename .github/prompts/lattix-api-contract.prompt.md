---
name: lattix-api-contract
description: Design or review a stable, secure API contract
argument-hint: "<endpoint, event, schema, or API change>"
agent: agent
---

Design or review this Lattix API contract.

Check:
- Clear request/response schema.
- Validation by type, length, range, format, and auth context.
- Stable error codes and typed/structured errors.
- Backward compatibility and versioning.
- Idempotency for write operations where relevant.
- Authn/authz fail-closed behavior.
- No secrets or PII in logs or responses.
- Contract/integration tests.
- Observability for latency, errors, throughput.

Return:
Contract proposal; compatibility notes; tests; implementation guidance; rollout/rollback.