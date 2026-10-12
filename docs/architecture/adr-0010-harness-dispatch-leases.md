# ADR-0010 — Durable tenant-scoped dispatch leases (PER-1059)

**Status:** Internal broker foundation increment. This PR does not execute an AI harness, expose an HTTP queue, or provide an at-least-once production worker.

## Decision

Savant is the quality engineering plane for customer-operated AI harnesses and workflows. A run reserved by PER-1059 must be claimed by exactly one **authorized** internal worker at a time before it may invoke a customer harness. Multiple worker processes must not claim the same reservation concurrently. The lease is stored in PostgreSQL, not in a process-local map.

Migration `0019_harness_dispatch_leases.sql` adds one row per tenant+run with adapter and worker identity, SHA-256 of a newly generated 256-bit lease token, monotonically increasing generation/attempt, a bounded lease deadline, retry eligibility, and state. No raw lease token, provider credential, payload, prompt or model content is persisted.

`createHarnessDispatchLeaseQueue` is an internal service with four operations: `claim`, `renew`, `acknowledge`, and `releaseForRetry`. Each requires a trusted injected `authorizeWorker(tenantId,adapterId,workerId)` verifier. A worker string supplied by a client is **not** proof of identity. Authorized workers are scoped to the owning tenant and adapter.

## Consistency and concurrency

- `claim` uses tenant-organization row locking, `FOR UPDATE OF r SKIP LOCKED`, and atomic insert/update of the lease. Only `queued`, unexpired runs with eligible retry windows are claimable. Canceled, running, expired or terminal runs are not dispatched.
- Fencing uses a fresh cryptographically random token, whose SHA-256 only is persisted, and monotonic lease generation. The raw token is returned once to the worker and must never be logged, embedded in a prompt or sent to a provider.
- `renew`, `acknowledge` and `releaseForRetry` lock the run row **before** its lease row to maintain a consistent order with claiming and cancellation; they require a live lease, matching authenticated worker ID, correct token hash and queued run state.
- An expired lease may be reassigned to another worker. The previous worker cannot acknowledge a stale token. No lease can extend beyond the reserved run's deadline.
- `releaseForRetry` delays new claims and caps attempts at 4. Exhausted leases stay non-claimable until operator reconciliation or deadline expiry. This avoids fabricating provider failure and does not delete provenance.
- `acknowledge` atomically updates the run to `running`, marks the lease acknowledged and writes the existing metadata-only transition audit. It is an acknowledgment of successful **external dispatch**, not proof of successful evaluation.

**Important external side-effect limitation:** A worker may crash after the customer harness accepted its request but before Savant recorded acknowledgment. A reclaimed run can therefore cause repeated external dispatch. The production dispatcher MUST forward the original run `idempotencyKey` to the provider and require the customer's adapter to support idempotent execution, or a provider-specific reconciliation mechanism. Leases alone do **not** guarantee exactly-once external execution, billing correctness or safe cancellation.

## Test coverage and acceptance

The deterministic unit/security suite rejects fabricated tenant, adapter and worker identities, worker authorization outage, out-of-bounds lease/backoff, malformed external run IDs, and all unauthorized operations before database I/O.

The PostgreSQL 16 integration `apps/web/scripts/verify-harness-dispatch-leases.mjs` creates disposable tenants and reservations, then verifies:
- Parallel independent-worker claims obtain **different** run IDs.
- Cross-tenant/adapter/worker spoofing fails closed; canceled work is never claimed.
- Raw token is never stored; token hash and generation fence expired/foreign workers.
- Bounded retry delay, lease renewal, stale-worker reclaims, and cancellation races.
- Successful acknowledgments update the run state and append transactional audit.
- Deleting a tenant cascades dispatch receipts without leaking to another tenant.

CI must run frozen pnpm install, existing Node/Python regressions, lint, typecheck, production build, secrets, the **blocking high/critical production dependency audit**, migrations applied twice, and the new isolated PostgreSQL test. All checks must pass at the exact PR head and receive independent review before merge.

## Operations, rollout and limitations

No background worker is deployed by this PR, and the methods are not public HTTP endpoints. Production rollout must add a trusted workload identity verifier, a bounded worker supervisor, health/liveness checks, retry classification, worker heartbeats, observability, durable provider error capture, lease-expiry monitoring, and staging crash-recovery tests. For emergency rollback, disable dispatch workers and preserve the run/lease tables and audit data. Do not remove receipts or assume a lease expiration canceled an external model call.

**Parent PER-1059 remains In Progress.** Production provider execution, signed endpoint integration, cancellation propagation, result ingestion, deterministic baseline/candidate scoring, cost settlement and measured SLOs are still outside this increment.
