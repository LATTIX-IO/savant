# ADR-0005 — PER-1059 durable evaluation invocation foundation

**Status:** Internal reservation and ordered-receipt foundation only. NOT a production executor, public API, signed webhook receiver, inference router or full evaluation broker.

## Decision

Savant orchestrates QA of customer-owned AI workflows. The customer harness remains solely responsible for AI inference and tool execution. The server-internal reservation store at `apps/web/src/server/harness/invocation-reservations.ts` persists immutable metadata in PostgreSQL without connecting to a harness.

Reuses `@savant/types/harness-adapter` and `@savant/schemas/harness-adapter` v1 validation. Migration `0015_harness_invocation_reservations.sql` adds:
- `harness_eval_runs`: tenant, adapter, actor, immutable digests, opaque input reference, idempotency digest, reserved cost/time, capture/retention/residency, deadline and status
- `harness_eval_events`: uniquely identified, ordered status-only receipts with a composite tenant/run foreign key
- `harness_eval_transitions`: transactional, append-only metadata audit

Existing `skill_runs` records observed telemetry, not authorization/reservation of a synthetic QA execution.

## State and race policy

`queued` → `running` → `succeeded|failed|timedOut|canceled`.
`queued|running` → `cancelRequested` → `canceled|failed|timedOut`. Late success during cancellation returns `cancel_race` for explicit reconciliation. Terminal runs cannot reopen. `expireDue` marks stale reservations timed out and frees quota, but does NOT prove remote execution has stopped.

Both `reserve` and `expireDue` lock the authoritative organization row in a transaction to serialize tenant quota reservations across independent processes. Idempotency is unique on `(organization_id,idempotency_key)` and canonical SHA-256 of the validated request. Reusing a key with changed content or a run ID under a different key fails. Duplicate event ID/sequence is only replay-safe if status and trace match. Out-of-order, foreign tenant, conflicting and late receipts are refused. State transition, event insertion and metadata audit commit atomically.

`maxReservedCostUsd` is an authorization ceiling, not an invoice; quota arithmetic is evaluated in micro-US-dollar units. A future settlement engine must reconcile actual metered provider cost and handle reimbursement, retries and orphan-job cancellation.

## Trust boundary

All store methods are **private server methods, never public routes**. The authenticated control plane MUST verify OAuth/mTLS or signed token issuer/audience, scopes, tenant and actor membership, permission to read the pinned Git artifacts, adapter ownership and consent before invoking them. The store rejects mismatched tenant and actor but does not authenticate tokens by itself. A future event-ingest endpoint MUST cryptographically verify the remote harness webhook signature and connector binding before calling `applyEvent`.

No raw prompt, response, tool payload, AI provider credentials, bearer tokens or complete content are stored by the new tables. The actor field is an opaque identifier and should be pseudonymized before production exposure. Cross-tenant run queries return indistinguishable not-found errors, and the composite DB FK prevents foreign receipt attachment.

## Verification gates

- `pnpm test` includes tenant spoofing, unsupported capability, malformed IDs, unsafe getters, and quota rejection before any database I/O.
- `pnpm db:migrate` twice, proving migration idempotency on isolated PostgreSQL 16.
- `SAVANT_HARNESS_SCHEMA_TEST=1` and local `DATABASE_URL` trigger `apps/web/scripts/verify-harness-reservations.mjs`. The script refuses production hosts, provisions disposable orgs, and verifies independent-store concurrency, replay, quota caps, foreign-tenant denial, cancellation races, malformed events, expiry, metadata audit and cascade.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, secret scanning and the blocking production dependency audit continue to be required.
- Exact-head CI and independent reviewer/security approval are mandatory before merge.

Runbook for orphaned jobs: disable dispatch in the future controller, inspect only redacted metadata, expire verified stale tenant reservations, and reconcile late provider completions explicitly. Never drop the durable receipt tables to roll back a deployment; roll back code while preserving the audit trail. Do not use this reference store as a public API.

## Outstanding full PER-1059 DoD

**Not delivered in this increment:** live secured HTTP routes and verifier; harness dispatch, real cancel, queuing; cryptographically authenticated webhook ingestion; durable rejected-event quarantine; encrypted result artifacts; baseline/candidate scorecard evaluation; provider cost settlement; 429/5xx retries; exact cancel-vs-complete reconciliation; native OTel and real-harness integration; workload performance benchmarks and SLO evidence. This must be developed and validated before declaring PER-1059 or the Savant MVP complete.
