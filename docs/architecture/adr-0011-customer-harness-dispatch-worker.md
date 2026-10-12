# ADR-0011 — PER-1059 customer-harness dispatch worker increment

**Status:** Internal reference dispatcher. It can drive a **mock or injected** customer-owned harness adapter, but it is not deployed as a production broker or exposed as an HTTP endpoint.

## Purpose and execution boundary

Savant is the QA and optimization workbench for customer-owned AI skills and workflows, not a new harness or inference router. Building on ADR-0010's PostgreSQL lease foundation, this increment connects a claimed, tenant-scoped reservation to a trusted external-harness transport through a small server-only `tick()` worker.

`apps/web/src/server/harness/dispatch-worker.ts` receives injected lease queue, authoritative DB context reader, approved adapter resolver, deadline clock, and metadata-only audit. It calls a customer-provided `invoke(request, {signal,timeoutMs,idempotencyKey})` only when all guards pass.

**Critical prerequisite:** The adapter resolver must certify *durable provider-side idempotency*. If it is missing/false, execution fails closed. Leases alone never deliver exactly-once external side effects; a crash after provider acceptance can cause a duplicate request, which MUST reuse the original run idempotency key and require reconciliation.

## Input, authorization, and response validation

`apps/web/src/server/harness/dispatch-run-context.ts` reconstructs the request from the tenant-owned `harness_eval_runs` table, never from browser JSON or an untrusted operator. It verifies row status is `queued`, deadline, pinned spec hash, suite hash, input reference, run/adapter/trace, and immutable idempotency key against the claim. It also calls an injected `authorizeArtifacts` that **must** verify tenant membership/actor authority and permissions for the immutable Git spec, evaluation suite, and fixture. If DB access, ACL, or config resolution fails, no remote execution occurs.

Adapter capabilities must parse as protocol v1, support execution, bind to the same adapter ID, and admit the requested budget and capture policy. The transport receives an abort signal, max duration bounded by the lease and request, and the **original** idempotency key. The worker does not pass the lease-fencing token to a provider.

Only a minimal allowlisted `HarnessRun` can acknowledge dispatch: matching tenant, adapter, run, trace, spec and suite hashes, a valid opaque `externalRunId`, and `queued|running` state. A falsely terminal or malformed provider return is not accepted. Successful acknowledgment is recorded through the existing lease queue, atomically setting the reservation to `running` and adding the metadata transition audit; it does **not** assert that an evaluation succeeded.

## Provider errors and cancellations

A preflight denial releases the lease into bounded retry and emits only a safe audit reason. Once provider invocation starts, a thrown exception, timeout or malformed response requires **explicit reconciliation**. The worker must NOT assume an exception means the external harness did not accept the request or blindly submit another job. If the provider finished but the lease was canceled, expired, or taken over before acknowledgment, the worker also reports `reconciliation_required`. A future production reconciler must query the provider by original idempotency/run ID and process signed events through ADR-0006/0007/0008 before resuming; never fabricate a terminal result.

This implementation passes `AbortSignal` to the adapter transport. The provider adapter is required to implement real network-level timeouts and abort propagation. A faulty adapter that ignores cancellation may continue running; no in-process timer can reverse already issued external side effects. Production integration must enforce a hard timeout at the transport/worker isolation boundary.

## TDD and acceptance

- Unit tests: empty queue, correct canonical request/idempotency, unverified provider idempotency, spoofed tenant/trace/spec/suite/input, raw content, invalid provider status, provider-side unknown success and post-dispatch cancellation, expired lease.
- PostgreSQL integration: migrations applied twice, disposable two-tenant setup, lease claim, authorized immutable artifact retrieval, mocked external adapter call with original key, atomic run status/audit, unauthorized fixture block, foreign tenant denial, and uncertain provider failure without blind retry.
- Existing required gates: Node and Python regression, lint, typecheck, production Next.js build, secret scan, blocking high/critical dependency audit, PostgreSQL tenant checks and concurrency tests.
- Independent code/security reviewer approval; live customer-harness staging run and cancellation/latency/idempotency evidence before allowing production execution.

## Deployment and rollback

This PR does **not** start a background daemon, publish a callable HTTP route, create an external adapter credential integration, or claim complete baseline/candidate scoring. No provider secrets are stored or logged here. Rollout must configure trusted workload identity, tenant/adapter-specific connector credentials, bounded worker concurrency, network egress allowlists, endpoint TLS, external idempotency conformance, telemetry, redacted diagnostics and alerts for reconciliation-required runs. To roll back, stop workers and preserve run/lease/event/audit tables without deleting provenance.

**PER-1059 and Savant MVP remain In Progress.** Further increments must implement real transport adapters, credential resolution, signed-event result ingestion, cancellation propagation, reconciliation, objective scorecards and verified cross-tenant production UAT.
