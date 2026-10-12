# ADR-0012 — Persist the external dispatch side-effect boundary (PER-1059)

**Status:** Private durable reconciliation hold, not a production reconciler.

## Failure prevented

PR #54's worker returns `reconciliation_required` when the customer harness may have accepted a request, but a previously leased run remains `queued` in the reservation store. Without a durable marker, expiry can allow another worker to claim and re-execute that same provider operation. A provider-side idempotency contract is necessary but insufficient: a malicious, faulty or unsupported adapter could duplicate charges or side effects. This increment prevents **automatic** redispatch once Savant has committed that an external side effect may start.

## Transactional protocol

Migration `0020_harness_dispatch_reconciliation.sql` extends `harness_eval_dispatch_leases.state` with `dispatching` and `reconciliation`. Only safe enum reasons are permitted on reconciliation rows, and existing audit transitions are expanded to include `dispatchStarted` and `reconciliationRequired`. Additive migration retains all existing lease and run receipts.

The worker must call `markDispatchStarted(tenant,adapter,worker,run,leaseToken)` and await a successful **database commit before** any provider invocation. That operation locks the authoritative run row before the lease row, verifies the authenticated worker, live token, queued run state and deadline, changes the lease to `dispatching`, and appends a metadata-only audit record atomically. The claim query deliberately excludes `dispatching` and `reconciliation` even if their lease times expire.

Once the adapter call is attempted:
- A valid, timely provider dispatch acknowledgment is the only ordinary path to `acknowledged` and run status `running`.
- Provider exception, non-cooperative timeout, malformed acknowledgment or acknowledgment failure creates a `reconciliation` hold (where possible), retaining the original run ID and provider idempotency key for later operator/provider reconciliation.
- If the worker crashes after `dispatchStarted` but before recording `reconciliation`, state remains `dispatching` and is **still blocked from automatic reclaim**.
- A stale, foreign tenant, canceled or invalid lease cannot begin provider I/O; preflight failures before side-effect marking remain eligible for bounded retry, never provider replay.
- Status remains `queued` on uncertain outcomes; do not fabricate `failed`, `succeeded` or `canceled` until the provider supplies verified evidence.

**Trade-off:** A process may crash immediately after committing `dispatchStarted` but before issuing the HTTP request, leaving a safe false-positive reconciliation hold. Availability is sacrificed intentionally to avoid duplicate external side effects. A future authorized reconciler can query provider status using the original idempotency key, validate signed results, and either release or finalize the run. A broad “retry all uncertain runs” job is expressly prohibited.

## Security and regression gates

- Unit tests verify the lease marker precedes provider invocation; invalid/missing adapter or artifact permissions cannot cross the side-effect boundary. Provider errors, invalid provider responses, and canceled acknowledgment record safe reasons and never blindly retry.
- PostgreSQL integration verifies a `dispatching` lease cannot be reclaimed after its deadline, `recordUnknownOutcome` changes its state without leaking raw provider errors, wrong-worker and wrong-token attempts fail, and the state remains blocked under multi-worker execution.
- End-to-end simulated provider dispatch integration confirms authorized acknowledgments become `running`, unknown provider outcomes persist in `reconciliation` across expiry, and repeat worker ticks do not re-invoke the customer harness.
- Existing Node/Python suites, typecheck, lint, build, secret scanning, blocking production dependency audit and migrations applied twice remain required, plus independent security review.

## Operational and rollback restrictions

No HTTP route, vault integration, production worker supervisor or real provider-side reconciliation is enabled by this increment. Do **not** truncate the lease table, change uncertain states back to `leased`, or shorten the safety hold during rollback. Disable dispatch, preserve metadata, investigate the customer provider's idempotency ledger and original run ID, and reconcile explicitly under tenant-scoped operator authorization. Collect alert counts on stale `dispatching` and `reconciliation` states, but never include raw provider error messages, secrets or prompts in logs.

PER-1059 and the Savant MVP remain **In Progress** pending production credential-backed connectors, cancellation propagation, signed-event result ingestion, scorecards, cost settlement and real-harness UAT.
