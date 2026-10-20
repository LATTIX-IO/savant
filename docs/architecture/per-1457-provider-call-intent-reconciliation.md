# PER-1457 — durable pre-egress provider-call intent reconciliation

## Scope and security invariants

Savant Test Bench makes external NIM/OpenAI and Jev calls which may incur charges even if an HTTP request times out or fails before the server receives provider usage. Earlier receipts (PER-1447) reflect only positively acknowledged provider-reported tokens. A missing receipt does **not** mean the provider did not execute or bill.

This increment records a durable **pre-egress dispatch intent** before each external Test Bench call, distinguishing unknown external consequences from confirmed usage. It does not introduce real billing, rates, invoices, cost forecasts or a second inference gateway.

- Migration `0031_test_bench_provider_call_intents.sql`: tenant/run/case/phase unique identity; associated job UUID; server-derived `nim|openai|jev`; UTC timestamps `recorded_at` and nullable `acknowledged_at`. Composite tenant/run FK, 1–4 case CHECK, phase/provider CHECK, timestamp CHECK and read-oriented pending index.
- `createObservedProviderCallIntentStore.record`: transaction locks exact tenant/run/job row, refuses non-running state, invalid case sequence, duplicated provider intent and judge before authenticated executor usage ACK. No API route exposes this mutation.
- The evaluator calls `onAttempt` immediately after the existing cancellation/credential preflight and before each executor/Jev HTTP request. Any write failure throws and **prevents that request**. After response validation, PER-1447's usage store commits receipt + counters + matching intent `acknowledged_at` in the same transaction, including a legitimate response that arrived after cancellation.
- An intended call can still be blocked by the network before reaching a provider; therefore an unmatched intent records **uncertain provider impact**, not confirmed provider execution or charge.
- Run `get`, `list`, idempotent replay and cancellation readback project a bounded `unconfirmedProviderCalls` count from **tenant-scoped** unmatched intent rows. The Test Bench UI explicitly states charges **may** exist and actual amounts are unknown. Never label this count as invoiced calls or cost. Historical pre-0031 runs show **zero recorded unconfirmed intents**, not guaranteed zero external charges.
- Score publication still requires a complete, exact provider-usage receipt set and additionally refuses any unacknowledged dispatch intent. No automatic retries, no refunds, no fabricated evidence, no cross-tenant provider metadata disclosure.

## Limits and known risks

The gap between intent commit and outbound network submission cannot be proved exactly without provider-issued idempotency/settlement mechanisms. Intent existence is not an invoice; its absence in historical data is not a guarantee of zero charges. Provider origin/model trust stays with the configured adapter. The current 10-run daily tenant limit and shared NIM/Jev admission ceilings are normalized capacity reservations, not financial entitlements or actual provider cost controls. These limitations remain explicit release gates under parent PER-1441.

No customer-owned harness, tool/MCP execution, endpoint agent, provider pricing engine or automated invoice reconciliation is added.

## TDD and acceptance

- Node unit tests: server-controlled `nim|openai|jev` mapping and input bounds; pre-egress ordering before each model call; injection of a write failure forbids further provider I/O; judge cancel path creates no intent.
- New isolated PostgreSQL `verify-provider-call-intents.mjs` with an explicit loopback-only guard: 12-way same-intent race; exact tenant/run/job authorization; malformed index/phase/source; judge-before-executor refusal; duplicate-intent blocking; pending-to-ACK atomic transition; cancellation with late ACK; failed external timeout remains unconfirmed; completed worker with two confirmed phases; foreign tenant FK/read denials; schema CHECK rejection; metadata-only audit.
- Blocking GitHub workflow: apply schema **twice** then run all preexisting Test Bench source-pin, crypto, case, cancellation, comparison, BYO, quota and provider-receipt scripts before new intent acceptance. Exact-head Node, lint, TypeScript, production Next build, secret scanner, blocking high/critical production dependency audit and preview READY are required.
- External release requirements: independent reviewer/security signoff, managed `TEST_BENCH_ENCRYPTION_KEY` and `AI_CONNECTION_ENCRYPTION_KEY` rotation/restore, authenticated Auth0 multi-tenant NIM/OpenAI/Jev smoke, provider invoice reconciliation process, protected `main` and genuine entitlement/spend governance. Until then PR remains draft and no production claim is permitted.

## Operational interpretation

`unconfirmedProviderCalls = 0` only means all **recorded pre-egress intents** for the run have provider-reported usage ACKs. It does *not* certify settled billing. `unconfirmedProviderCalls > 0` requires explicit operator reconciliation, not automatic debit/credit or retry. Avoid automatic clearing after cancel/failure/redeploy. Preserve pending evidence through worker retention and do not store case prompts, output, API keys, headers or raw errors in the intent ledger.
