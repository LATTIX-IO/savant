# ADR-0023 — Terminal cancellation for observed Test Bench runs

**Status:** Proposed MVP increment, PER-1429 / PR #66. Stacked on PER-1425 / PR #65. Do not merge ahead of verified dependencies.

## Problem and external boundary

Savant supplies reusable, reproducible **QA** for skills and AI workflows. A saved-case chat-only evaluation must let an authorized user stop pending work and stop scheduling further provider requests. The platform cannot promise synchronous termination or reimbursement for an inference request already accepted by NVIDIA NIM or Jev. It also cannot claim customer-harness cancellation: real external harness integration remains PER-1059.

## Durable state and authority

Migration 0025 extends `test_bench_runs.status` with terminal `canceled`, `canceled_at` and `canceled_by`. A database CHECK prohibits completed scorecards on canceled rows. Already-completed and failed results are immutable. Encrypted partial samples and the immutable source SHA/revision remain intact.

An authenticated `POST /api/skills/[id]/test-bench/[definitionId]/runs/[runId]/cancel?workspaceSlug=<slug>` accepts only `{"expectedRevision":1}`, with bounded JSON body and same-origin CSRF checks. The server authorizes the active tenant and resolves the real repository-manager/admin actor. A `SELECT ... FOR UPDATE` ensures an exact tenant, skill, definition, run and suite-revision match. The terminal transition and metadata-only audit happen in one transaction. A duplicate cancellation returns the existing canceled state, without a second audit event or cross-tenant data exposure. Invalid or already-terminal requests fail safely.

For queued work, the same transaction marks the queued background job `failed` with a non-sensitive fixed cancellation description: the queue cannot claim it afterward. For already-claimed work, a worker may have begun provider I/O. Before first case, every later case, and each judge call, the worker reads the durable status; when canceled, it makes no new calls. Existing `recordCase` and `complete` status CAS checks reject stale writes and prohibit post-cancellation scores even if a network call returns after cancellation.

## User-visible semantics

The UI exposes **Cancel run** only for queued or running cases, keeps the same-source rev and run ID in the request, shows a truthful `canceled` badge with previously observed cases, and clearly states in-flight provider calls may complete and incur cost. Canceled results have no aggregate pass rate, promotion attestation, or quality gate claim. New separate runs may start after cancellation.

## Test-driven acceptance

- Unit: strict cancellation request contract; provider never called before first case; canceled after NIM prevents Jev; after one case prevents future inference; no synthetic score.
- Client/HTTP: tenant slug, same-origin credentials, exactly scoped run ID and immutable revision; no caller-supplied Git ref, model or secret; error/canceled response provenance validated.
- PostgreSQL: permission/tenant denial; stale-revision rejection; replay idempotency with one audit; queued de-claim; cancellation during real-injected NIM call; complete-case receipt cannot overwrite canceled state; encrypted partial observations and metadata-only audit. Migration suite runs twice.
- Independent audit and live authenticated smoke remain release gates, alongside blocking dependency remediation, key provisioning/rotation, and real production NIM/Jev acceptance. This PR is not deploy authorization.

## No false guarantees

Cancellation is **best-effort at model-request boundaries**. It does not invoke provider-specific cancel APIs, abort existing remote calls, refund previously incurred charges, or cancel an external customer harness. Stronger cancellation requires PER-1059 adapter conformance and provider acknowledgements in a subsequent increment.
