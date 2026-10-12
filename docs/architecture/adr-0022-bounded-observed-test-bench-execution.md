# ADR-0022 — First real saved-case execution path (PER-1425)

**Status:** MVP increment in draft PR #65, pending exact-head CI, deployment configuration and independent review.

## Contract, differentiation and limitation

Savant is a **quality engineering workbench for externally supplied skills and AI workflows**, not a new harness or general inference router. This increment adds **real chat-only** test execution of user-authored saved Test Bench cases using the existing configured NVIDIA NIM chat provider and Jev rubric judge. These are real inference calls and observed graded responses, **not simulated Test Bench scores**. This increment does **not** execute scripts, MCP tools, multimodal files, customer-harness workflows or external agent actions.

## Immutable admission and tenant controls

All calls require active authenticated workspace membership, a server-resolved tenant, server-side Git RBAC, and a same-origin mutation header. Caller input contains only an idempotency UUID and the saved suite's exact `expectedRevision`. Caller-controlled model, provider, Git revision, case content and tool privilege fields are rejected. Admission atomically verifies a tenant-owned nonarchived definition (PER-1422), reserves one live run per definition, limits two active runs per tenant, encrypts a full **immutable case snapshot** with the run ID/revision/Git-SHA AAD, inserts a durable run receipt, queues a payload containing the run UUID only, and writes metadata-only audit.

An edited suite or a default-branch move after queueing **cannot** change the run's cases or its pinned Git source. A separate run encrypts each observed per-case output/verdict and keeps a token/cost counter. Source is fetched at the saved commit, never mutable HEAD. Cross-tenant repositories and run IDs cannot be read or executed through the tenant API.

## Runtime bounds and no-synthetic-evidence rule

- At most **4 cases/run** in this first adapter; the suite editor allows up to 8, but oversized suites are explicitly not executable in this mode.
- Sequential NIM generation timeout 15 seconds with max 400 output tokens per case; Jev validation timeout 10 seconds; total token budget 12,000; **estimated** model-cost ceiling USD 0.05; run function maxDuration 300s with 230s worker budget.
- Judge must return all typed, numerically bounded score/binary/revision answers. Both providers must report positive token usage. Missing or invalid evidence, timeout, missing source, invalid cached run or provider failures terminate **failed** with a safe error code, without a fabricated grade.
- Only after **every** case has a model response and real Jev grading does the server compute a scorecard. Interrupted or failed runs may display encrypted **partial observed evidence** but have no aggregate score.
- Because a worker may be killed after a paid provider call, **reclaimed leases are never replayed against the provider**. An uncertain retry becomes a failed run, requiring manual requeue with a new idempotency UUID. This sacrifices automatic recovery for at-most-once best-effort side effects, not exactly-once provider settlement.

## Storage, audit and security

Schema 0024 stores receipt metadata and run ID with encrypted case/result blobs. No full prompts, source instructions, outputs or API credentials enter the queue payload or audit. Encryption reuses the separately configured `TEST_BENCH_ENCRYPTION_KEY` AES-256-GCM primitive from PER-1422. Row identity, immutable commit and suite revision are AAD-bound. Tenant/resource foreign keys and live-run unique constraints prevent cross-tenant attachment and double-active sessions.

Migration 0010 and 0011 job-kind CHECK constraints are extended so rerunning older migrations does not reject newer 0024 jobs. A row-level idempotency gate and metadata-only audit occur in the same SQL transaction as queue admission.

## TDD and acceptance requirements

- Unit: provider/Jev mocks validate real call count, typed answers, observed latency/token/cost, partial failure without score, missing usage, case limit and token/cost exhaustion.
- API/security: cross-tenant/role/CSRF controls; same-origin GET/POST; caller cannot supply credentials, provider selector, source commit or custom tool actions.
- PostgreSQL isolated acceptance: admission idempotency, frozen snapshot after definition/index updates, repository/source tenant FK, encrypted result persistence, failed unreplayable lease and no plaintext in jobs/audit. Migrations must apply twice.
- Release: independent code review, blocking high/critical production dependency audit after PR #46 reconciliation, Vercel `TEST_BENCH_ENCRYPTION_KEY` provisioning and recovery, real Auth0-tenant E2E and real NIM/Jev service smoke. GitHub CI plus Vercel READY alone are **not** evidence of a production-ready evaluator.

## Deferred gates

External customer-harness connector execution and signed invocation receipts (PER-1059), durable run cancellation, cost reservation/settlement, BYO model selection, true paired candidate/baseline reproducibility, statistical confidence, signed quality attestation and managed encryption-key rotation/backup are separate follow-on increments. No automatic promotion/rollback is authorized from provisional chat-only scores.
