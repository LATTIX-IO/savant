# PER-1545 — Versioned provider rate contracts and conservative monetary admission

## Accounting boundary

This increment enables **rate-versioned, tenant-scoped planning reservations** for Savant Test Bench. A reservation is **not actual billed provider tokens, dollars, a provider invoice, a contractual spending cap, or settlement**. Actual outcomes require provider billing export reconciliation and uncertain-call handling from PER-1457.

The existing quality-comparison `estimatedCostUsd` remains a normalized QA proxy and is **not modified** by the monetary reservation. OpenAI runs using tenant-owned credentials are **externally billed** and only Savant's shared Jev judgment is included in Savant's monetary reservation. Platform NIM runs reserve for both NIM and Jev.

## Schema and rate provenance

Migration `0032_test_bench_monetary_admission.sql` creates:
- `test_bench_provider_rate_cards`: immutable once approved except controlled `active` boolean. UUID, human-readable version, verified HTTPS source URL, SHA-256 of contract/rate evidence, approval actor and timestamp, effective window, USD currency, single-active constraint. Multiple historical approved cards coexist; only one is active for **new** admissions. Old run IDs retain their card ID and remain interpretable after rate activation changes.
- `test_bench_provider_rate_entries`: exact provider/model entries with integer input/output **micro-USD per one million tokens** and optional fixed micro-USD per call. Modifying entries of approved cards is rejected in PostgreSQL; a database row lock ensures activation cannot race a rate-row edit.
- `test_bench_tenant_monetary_policies`: explicit enabled entitlement, revision, UTC-day and UTC-month micro-USD ceilings. No tenant receives an implicit policy.
- `test_bench_tenant_monetary_days` and `_months`: per-tenant reservation ledgers with an atomic conditional UPSERT for each period; both execute with existing tenant/global run reservations and enqueue in a single transaction. Day then month lock order; month refusal rolls back day and all other mutations.
- `test_bench_runs.rate_card_id`, `reserved_micro_usd`, `judge_model_pinned`: immutable **admission-time** rate version/cushion provenance; platform execution model is also pinned when monetarily gated.

**No real provider prices, contract identifiers, or production tenant budgets are seeded.** Deployment to production with missing approved rates or a missing tenant policy is expected to deny new Test Bench runs.

## Enforcement and limits

`monetaryAdmissionRequired` is enabled if `VERCEL_ENV=production`, regardless of an explicit opt-out, or when `SAVANT_TEST_BENCH_MONETARY_ENFORCE=1` is specified for local tests. Nonproduction can exercise legacy regression suites without fabricated rates.

At admission:
1. Existing authenticated tenant and idempotency checks run first. A true same-request replay does not reserve money twice.
2. Read exact server-side NIM execution and Jev judge models. Workspace OpenAI uses a pinned tenant-owned model, but its external costs are **not** priced against Savant's provider ledger; Savant Jev is still required and priced.
3. Under a transaction, require a currently effective active approved card and a matching price for **every Savant-paid model**; require an enabled monetary tenant policy. No dynamic caller-supplied price, model, rate version, or source URL is accepted.
4. Reserve `cases * (ceil((32768*inputMicroUsdPerMillion + 8192*outputMicroUsdPerMillion)/1000000) + fixedMicroUsdPerCall)` for **each** Savant-paid model. All arithmetic uses integer/BigInt with a strict numeric bound. These are **conservative planning token assumptions**; provider tokenization, cache, pricing tiers, tool behavior and unknown provider side effects are not guaranteed to respect these assumptions. Do not call this a provider hard spending limit.
5. Require that the new reservation fits the tenant daily and calendar-month policy. Conditional UPSERT and database uniqueness/CHECK constraints prevent concurrent over-admission. **Never refund automatically**, including cancellation or failed transport, because the provider may have performed an uncertain billable side effect.
6. Save the exact approved rate version, planned micro-USD cushion and configured model pins with the queued run. On each worker network-boundary check, fail closed if the tenant monetary policy was revoked, the rate window expired, or NIM/Jev model configuration no longer matches the pinned model.

## Operational rate activation procedure (operator-controlled)

1. Obtain verifiable provider rate/contract documentation for the *actual configured NIM execution model* and Jev judge. Record official/effective source, written approval owner, SHA-256 evidence digest, rate currency and exact price units. Jev may not be priced per token; model fixed-request fees explicitly when required. Never guess rates from marketing collateral or a normalized QA score.
2. Insert a **draft** rate-card version and exact model entries through an operator-controlled, audited migration/admin channel. No route is exposed to tenants for creating or editing price contracts.
3. Validate unit conversions, fixed fees, account discounts/tiers, applicability window, and provider-specific minimum billing before approval. Obtain independent financial and security signoff on the card and on tenant budget configuration.
4. Activate in a transaction: mark any previous card inactive, then approve/activate the new card, respecting the single-active unique index. The old card's approved contents remain immutable and historical run provenance stays intact. Apply tenant monetary policies only after plan/entitlement and commercial approval.
5. In isolated staging, use authenticated Auth0 tenants, actual NIM/OpenAI/Jev credentials and provider billing exports to compare observed token receipts with invoice amounts; reconcile PER-1457 outstanding intents separately. Verify canceled/timeout unknowns cannot reset the reservation ledger.
6. Require exact-head GitHub tests/approvals, Vercel preview readiness, managed encryption-key rotation and restore, protected `main` with required reviews, and rollback drills before production enablement.

## TDD / proof

- `monetary-admission.test.ts`: integer upward rounding, zero/negative/float/overflow rejection, no BYO OpenAI subsidy, production flag cannot bypass enforcement.
- `verify-test-bench-monetary-admission.mjs`: **ephemeral CI-only database**, two-stage schema migration applied twice by CI, draft/unpriced/disabled policy denial without job/quotas, approved-rate immutability, 12 simultaneous last-slot admissions, idempotent replay, nonrefundable cancellation, tenant isolation, daily/monthly ledger rollback, worker revocation/model drift, database integrity constraints and historical rate activation. The fixture's synthetic approved card is intentionally immutable: never run this script in a shared environment.
- Existing pinned evaluation, encrypted snapshot, BYO credential, cancellation, provider-usage receipts, global capacity and pre-egress intent scripts remain blocking regressions.
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm build`, committed-secret scan, production high/critical dependency audit, schema migrations twice, PostgreSQL integration and Vercel READY at exact head are required.

**Outstanding after this PR:** authenticated provider billing reconciliation, guaranteed financial limits, pricing proof from actual Jev/NIM contracts, tenant subscription/plan-to-policy administration, key management/restore evidence, independent security review, and protected GitHub production branch. Parent PER-1441 remains open; do not auto-merge or promote.
