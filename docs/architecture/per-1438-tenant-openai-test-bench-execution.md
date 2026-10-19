# PER-1438 — Tenant-owned OpenAI Test Bench execution

**Status:** Functional MVP increment, under development and independent review. This is tenant BYO-AI execution for chat-only QA, not a new harness/inference router.

## Contract and non-goals

The saved Test Bench run UI has an **explicit** execution choice:

- **Workspace default OpenAI (tenant key):** uses the active, default, execution-enabled `openai` connection from the current organization, stored in `ai_connections` and the existing AES-256-GCM `ai_connection_secrets` vault. A server-side worker decrypts the key with `AI_CONNECTION_ENCRYPTION_KEY` and performs a **single** OpenAI Chat Completions call per case using the provider's fixed official `https://api.openai.com/v1/chat/completions` endpoint. Jev remains a separate, explicitly platform-configured judge (`JEV_API_KEY`).
- **Savant NVIDIA NIM (platform key):** existing explicitly selected platform test path, unchanged. A failed tenant connection **never** falls back to NIM.

This is not arbitrary OpenAI-compatible routing, Anthropic or Azure integration, MCP/browser/tool workflow execution, or BYO harness support. Provider-specific adapters require their own conformance and egress-security review. Only OpenAI Chat Completions-compatible, version-pinned non-reasoning models are supported in this first slice.

## Tenant isolation and immutable credential pinning

Migration 0027 extends `test_bench_runs` with `execution_source`, tenant-composite-FK `execution_connection_id`, admission-time secret fingerprint and model, and `cost_accounting`. No raw key or encrypted key material is copied into run rows. Admission selects the **current organization**'s active default `openai` execution connection, verifies `allowed_models`, and snapshots its ID, model and fingerprint in the same SQL transaction as run/queue/audit creation.

Only `{requestId,expectedRevision,executionSource}` is accepted, with the old two-property admission defaulting to explicit legacy platform mode. The browser cannot submit tenant ID, connection ID, host, key, model, headers or arbitrary tools. Idempotency replays with a different execution mode are conflicts. The queue payload contains a run UUID only.

At worker admission, before **every external NIM/OpenAI/Jev boundary**, the source is reverified against the tenant-owned connection: status active, default execution, allowed model, pinned connection ID/model and secret fingerprint. Rotation, revocation, default reassignment, other provider types, missing `AI_CONNECTION_ENCRYPTION_KEY`, or tenant mismatch fail closed with safe fixed error codes. Decryption uses the existing organization/connection/provider AAD. Raw exceptions and provider response bodies are not logged.

The official OpenAI endpoint is constant; no tenant-configured base URL is used (protects against SSRF). Requests reject redirects, use an explicit abort deadline, have bounded prompts/output and response size, validate reported model and token usage, and have **no automatic retry** after a non-2xx response or timeout. A second paid request is never silently issued to compensate for an uncertain delivery. Queued cancellation semantics from PER-1429 remain enforced.

## Scoring and cost accounting

Jev produces real graded answers and the same immutable scorecard fingerprint as the existing NIM path. BYO uses the existing **normalized fixed-rate QA token-equivalent proxy** (`normalized-qa-proxy`) for deterministic relative scoring; this **is NOT the tenant's OpenAI invoice, spend cap, rate card, or currency forecast**. The 12k-token bound is enforced, but actual provider fees may exceed the legacy 0.05 USD proxy threshold. The UI must never portray this value as a guaranteed provider cost.

Cross-provider and cross-cost-accounting comparisons are prohibited. For BYO comparisons, the connection ID, pinned model, scoring contract and identical case set must match to avoid false equivalence; contract drift fails closed.

## TDD and operational gates

- Unit/contract: request only permits the fixed two execution sources, no caller-chosen host/model/credential; strict active/default/tenant/model allow-list/fingerprint; OpenAI single-attempt request, fixed-origin TLS/no redirects, JSON/usage/response length/errors/timeout bounds and sanitization.
- PostgreSQL: two orgs, tenant FK enforcement, encrypted BYO vault and source pin, idempotent admission and cross-mode conflict, actual injected HTTP OpenAI + Jev grade persisted with encrypted evidence, no credential in queue/audit, rotate/revoke prior to worker causes zero provider calls.
- UI/transport: explicit provider choice and token-vs-cost caveat, no plaintext key or provider endpoint in client request, correct tenant slug and Origin/RBAC.
- CI: exact-head Node/lint/type/Next/secrets; PostgreSQL migrations applied twice and tenant/evidence/race tests; blocking high/critical dependency audit inherited from PR #70; Vercel READY preview.
- Independent application/security review required. Before production: securely provision **two separate 32-byte keys**, `AI_CONNECTION_ENCRYPTION_KEY` and `TEST_BENCH_ENCRYPTION_KEY`, through protected environment secrets, document dual-key backup/restore/rotation, then prove a live Auth0 workspace connection, real OpenAI Chat Completions call, Jev grade and cross-device results. No secret values should ever be pasted into issues/CI logs or committed.

## Remaining MVP scope

Customer-owned harness execution and signed receipts (PER-1059), arbitrary provider adapters, paired statistically powered workflow experiments (PER-1073/PER-1075), actual provider cost-settlement and exception budgets, and production recovery/observability remain tracked separately. This PR does not authorize promotion or claim the system is deployed.
