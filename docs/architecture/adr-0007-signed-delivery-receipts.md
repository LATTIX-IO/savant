# ADR-0007 — Durable signed event delivery replay and atomic receipts

**Status:** Proposed internal PER-1059 increment, stacked on PR #49. This change is a durable extension of the *private* event admission and reservation services, not a live production webhook or a replacement for customer-owned AI runtimes.

## Scope

Migration `0016_harness_signed_delivery_receipts.sql` adds `harness_eval_deliveries` with composite `(organization_id,harness_run_id)` foreign key and a unique `(organization_id,harness_run_id,delivery_id)` constraint. Receipt rows include only delivery ID, event ID and SHA-256 of authenticated raw bytes, never body, prompts, model outputs, bearer credentials or HMAC secrets.

The v1 signed admission layer computes `payloadSha256` from an **owned snapshot** of authenticated request bytes, alongside the authenticated `deliveryId`. It passes both to the private reservation store after HMAC verification and tenant/adapter/run/trace matching. The store checks existing receipt fingerprints and commits a first receipt in the same transaction as ordered event insertion, state update and transition audit. Same delivery ID + same event ID + same digest returns replay without mutation; a changed event or digest returns `delivery_conflict`. Invalid delivery metadata fails before DB I/O.

The row lock on the tenant's run serializes same-delivery concurrent submissions across processes. The composite tenant FK prevents grafting foreign receipts. A rollback in any part of the transaction must remove delivery, event and transition together.

## Threat model, limitations and release gates

Tested negative cases: replay from another store instance, concurrent duplicate delivery, changed digest, changed event ID, foreign tenant, malformed delivery metadata, immutable terminal state, transaction audit and deletion cascade. Also checks that a mutable byte buffer or identity object cannot change the validated payload during asynchronous credential lookup (TOCTOU).

This is **not a cryptographic signing service**. The credential resolver still must be backed by a trusted vault, verify the tenant-to-adapter binding and enforce key revocation. This increment does not expose an HTTP route. Network authentication, raw-body handling, rate limiting, signing clock drift monitoring, durable rejection quarantine, actor and artifact ACL, HMAC key-rotation operational UAT, live provider dispatch and scorecard output must be separately validated before enabling real traffic.

Signed v1 delivery receipts are retained until the parent run is deleted by an authorized retention process. Do not truncate receipts on deployment rollback; downgrade by disabling ingress and preserving schema data.

## Required verification

- All existing Node and Python unit/regression/security suites
- Isolated PostgreSQL 16 migrations applied twice and `verify-harness-reservations.mjs` including signed receipt isolation, concurrency, replay conflicts and cascade
- TypeScript typecheck, lint, production build, committed-secret scan, and production dependency security audit
- Independent review and signoff, plus staging authenticated webhook smoke before a production ingress is wired

**PER-1059 remains In Progress.** Durable replay safety alone does not complete provider dispatch/cancellation, validated costs, results ingestion, persisted scorecards, or AI workflow QA acceptance.
