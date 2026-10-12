# ADR-0008 — Authenticated harness event rejection quarantine (PER-1059)

**Status:** Private reference increment, not a production ingress endpoint.

## Decision and scope

Savant measures customer-owned workflow/harness execution. A validly signed event can still be malformed or violate the v1 metadata-only event contract. Previously this event was rejected without durable evidence. This increment adds bounded, tenant-scoped and content-free rejection receipts after an event's HMAC signature and referenced run/adapter/tenant have been verified.

- `db/schema/0017_harness_event_quarantine.sql`: composite tenant-run FK, unique delivery ID per run, signed-payload SHA-256 and bounded reason enum. No raw payload, signature, key, prompt, tool arguments, response, or model content.
- `createHarnessEventQuarantine`: private PostgreSQL store; `record` locks the owned run, verifies adapter identity, rejects conflicting delivery replays, checks that the same ID has not already been accepted, and enforces 250 outstanding quarantine receipts per run. It derives `expires_at` from the run's `retention_days`, maximum 30. If retention is zero, no receipt is persisted. `purgeExpired(tenantId)` is restricted to the supplied tenant.
- `createSignedHarnessEventAdmission`: performs raw-body and identity snapshot before async key lookup, checks HMAC and verified tenant/adapter/run ownership, then optionally calls the private quarantine on invalid UTF-8, JSON or protocol event fields. Quarantine failures result in sanitized `quarantine_unavailable` instead of falsely claiming durable evidence. Invalid MACs and unknown/foreign runs are never quarantined.

The `quarantine` dependency is optional for existing reference adapter consumers and tests; **production ingress must supply a vetted durable implementation**. Do not expose it as a direct browser route. Do not use this table as an audit log for unverified network requests.

## Failure, replay, and privacy semantics

Quarantine is distinct from accepted delivery and evaluation tables. A receipt is keyed by tenant/run/delivery ID. An exact replay is idempotent; a changed digest/reason produces `quarantine_conflict`. A delivery ID already present among accepted events produces `delivery_conflict`. A run row is locked so concurrent workers cannot double-book a receipt or evade the per-run cap. Cross-tenant run mismatch returns `not_found`, and a composite FK enforces tenant identity at the database layer. The service is internal; only cryptographically verified callers should reach it.

Malformed HMAC signatures, revoked credentials, expired signatures and unknown runs must not cause quarantine writes. The payload hash is the SHA-256 of the exact authenticated raw bytes, captured before any awaited operation. Error messages are code-only and cannot reflect source secrets. The quarantine does not become evidence that any user content has been inspected or that all external providers are monitored.

## TDD, regression, and security gates

- TypeScript negative tests: invalid HMAC versus authenticated malformed event; UTF-8/JSON parsing; missing/foreign run; sensitive raw prompt field; quarantine outage; malformed metadata, fake DB rejecting any I/O.
- PostgreSQL migration applied twice. Integration tests verify HMAC→owned run→quarantine flow, duplicated invalid delivery replay, exact digest, expiry = allowed retention, accepted-delivery conflict, foreign tenant, zero retention and tenant-scoped expiry cleanup.
- Existing Node/Python suites, `pnpm lint`, `pnpm typecheck`, `pnpm build`, committed-secret check and blocking `pnpm security:deps` must pass at the PR head.
- Independent security review, live signed-provider smoke, credential-vault rotation and tenant-role validation are still required before any production webhook.

## Operations and rollback

A tenant-authorized worker must invoke `purgeExpired` regularly; scheduled deployment/monitoring are **not** part of this increment. Alert on `quarantine_unavailable` and `quarantine_quota` with tenant-scoped aggregate counts, never raw bodies. On storage outage, hold/retry signed deliveries safely; never report an event accepted and never store a prompt in fallback logs. Rollback should disable admission while preserving quarantine and accepted-delivery receipts; do not drop the table before expiry processing.

## Parent story status

PER-1059 remains In Progress. Production HTTP origin and signer verification, vault credential binding, provider dispatch, cancellation execution, durable error transport, replay reconciliation, metrics, measured SLOs, real harness smoke, cost settlement and baseline/candidate evaluation scorecards remain incomplete.
