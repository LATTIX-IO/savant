# PER-1447 — Immutable observed provider-usage evidence

**Status:** Draft incremental MVP scope. Does not establish real provider billing, monetary caps or deployment readiness.

## Problem

Savant evaluates skills and workflows as a QA workbench. A completed chat-only Test Bench run currently persists aggregate `total_tokens`, but an interrupted, failed or canceled run can have **real acknowledged provider usage** while `total_tokens=0`. Describing those runs as zero-cost or zero-token is misleading. A genuine OpenAI/NIM or Jev response may be billable even without a complete graded case; a timeout without response may incur usage **without any token report**.

## Contract

Migration 0029 adds an **append-only, tenant/run-bound, once-per-phase/case provider-reported usage receipt** with composite tenant/run FK, fixed `executor|judge` enum, case indices 1–4, positive bounded integer input/output token counts, bounded actual provider model ID and observation timestamp. No source prompt, case content, key, raw model output, network headers, error body, hard-coded pricing or dollar amount is stored.

The evaluator validates every provider's usage and awaits `onUsage` immediately after each executor or Jev response—**before another provider call, final scoring, or case persistence**. The worker records each receipt with one SQL transaction that row-locks the tenant-owned run, validates the original job ID and expected case number, checks idempotent duplicates, inserts the receipt and increments the observed executor/judge counters. Exact duplicates are a no-op, mismatched duplicates fail closed. The worker never retries model calls to recover a missing usage receipt.

**Cancellation race:** a network call may return after the human cancels the run. The worker still persists the actual provider ACK (the run remains `canceled` and can never gain a scorecard) and then refuses future judge/model requests. Similarly, if Jev fails, the acknowledged executor tokens remain visible even though the run is `failed`. No invented Jev receipt is added for an uncertain response.

Three bounded counters are exposed on tenant-scoped Test Bench run history/readbacks: `observedExecutorTokens`, `observedJudgeTokens`, and `observedUsageReceipts`. The UI explicitly states: **only tokens that the provider reported and Savant durably acknowledged; missing receipts do not establish zero charges**. Legacy scored `totalTokens` is retained for complete-run scoring compatibility, not redefined as billable invoice usage.

## Security, invariants and limitations

- Tenant FK prevents writing another tenant's run; job identity must match run; direct SQL CHECK bounds receipt keys, amounts, and phases. Rows are keyed by `(org,run,case_index,phase)` so duplicate callbacks cannot increment the total twice.
- Requests cannot supply tokens, models, prices or receipt records from the browser; only the server-side provider adapter creates receipts after validated responses.
- In-flight provider/timeout uncertainty remains separate from acknowledged usage. This increment **does not** implement actual provider cost rates, invoice reconciliation, reserve settlement, external provider cancel APIs, refunds, global platform caps, or financially backed cost guarantees. Keep parent PER-1441 open.
- Existing UTC-day admission quota (PER-1444) is unchanged, deliberately no refund/credit on cancel or provider failure.

## TDD / definition of done

1. Pure evaluator tests: callback ordering, live usage values, missing/invalid usage denies callbacks, cancellation after NIM before Jev retains NIM ACK, a database callback outage prevents further network calls.
2. Isolated PostgreSQL: a canceled in-flight NIM response leaves one acknowledged executor receipt but no verdict or score; complete run records executor+Jev and observed sum; failed Jev retains only executor ACK; exact same duplicate is idempotent; conflicting duplicate fails; ten simultaneous identical callbacks persist one receipt; foreign tenant, invalid model/index/amount, FK and SQL CHECK denial; no raw case/output/key/provider error in records, jobs or audits.
3. Client/UX/security: only authenticated tenant status reader sees bounded observed counters; forged negative/inconsistent values denied; UI never labels usage as actual invoice; no extra public mutation route to inject usage.
4. Full exact-head Savant Node/lint/TypeScript/Next/secrets, full tenant/observed/budget/cancel/compare PostgreSQL suite, idempotent migration, blocking high/critical dependency audit and Vercel preview READY.
5. Independent security review and staged real Auth0 tenant-owned OpenAI + Jev and NIM verification are external release gates; `TEST_BENCH_ENCRYPTION_KEY` and `AI_CONNECTION_ENCRYPTION_KEY` still must be provisioned and recovered safely.

This is another QA-observability slice, **not** a replacement inference router, autonomous agent harness or security product.
