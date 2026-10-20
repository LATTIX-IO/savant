# PER-1547 — Increment 7A: Unverified billing evidence and reconciliation boundary

## Status and nonclaims

PER-1547 is an **offline, provider-neutral, platform-operator-only ingestion and interpretation substrate** for Test Bench's platform-account NIM/Jev usage evidence. It is not an authenticated provider adapter, live invoice parser for a vendor-specific format, invoice settlement, budget cap, or customer billing system.

**Nothing in 7A establishes actual per-run, per-tenant, or even actual platform charges.** All imported sources have database-enforced provenance = `unverified`. No provider rate or invoice value is seeded or assumed. All API writes are server-only; no browser route is added.

Prior evidence boundaries remain:
- PER-1447: provider-reported positive token receipts, *not* actual billable tokens
- PER-1457: pre-egress dispatch intents, *not* proof a provider executed or charged
- PER-1545: version-pinned conservative monetary admission reservation, *not* invoice reconciliation or charge cap
- This PER-1547: unverified operator-provided account-level invoice-like documents, *not* settled vendor billing

## Canonical source contract

Inputs are **bounded exact UTF-8 JSON document bytes**, not independently normalized caller-supplied rows. The importer accepts 2 to 65,536 bytes, requires a SHA-256 of those exact bytes, and validates:

```json
{
  "schemaVersion": "savant.billing.statement.v1",
  "provider": "nim",
  "accountSha256": "<64 lowercase hexadecimal characters>",
  "utcMonth": "2026-10",
  "statementRef": "opaque-source-id",
  "sourceKind": "invoice",
  "issuedAt": "2026-10-16T00:00:00.000Z",
  "currency": "USD",
  "lines": [
    {
      "lineRef": "opaque-line-id",
      "model": "exact-model-identifier",
      "kind": "charge",
      "amountMicroUsd": "1000000"
    }
  ]
}
```

`sourceKind` may be `invoice` or `rated_usage`; provider is `nim` or `jev` only. `utcMonth` denotes the first calendar day of the UTC calendar month, not a provider billing timezone claim. Amounts are signed **string** micro-USD integers (no floats, exponent notation, negative zero, rounding or FX). Charge > 0, credit < 0 and <= original uncredited charge balance. Optional credit `corrects` includes `documentSha256` and `lineRef` of an earlier positive charge with the same provider, account, model. No raw invoice or provider response bytes are persisted—only bounded metadata, hashes and numeric lines.

A source digest proves **local byte integrity**, not provider authenticity. Operators must independently verify source provenance, account scope, invoice period and rate contract before making financial claims. SHA-256 account labels are pseudonyms, not anonymized identities.

## Persistence and concurrency

Migration 0033 adds `test_bench_billing_periods`, `test_bench_billing_documents`, and `test_bench_billing_lines`. Documents are immutable and uniquely keyed by (provider, hashed account, statementRef) and independently by (provider, hashed account, document SHA-256). Each line is unique within a document; composite FKs prevent foreign-account correction; server-side row locks prevent concurrent over-credit. Statements import within a single transaction. At the same time, the account's UTC-month lock serializes concurrent same-source imports, statement collisions, and freeze transitions. Twelve simultaneous imports of exact bytes must create one document, return eleven idempotent replay receipts, and never double-post lines.

`freezePeriod` is irreversible and prevents new imports, edits and deleting evidence. It is **not accounting period close**. Corrections are new source documents and signed append-only credit lines; no UPDATE or DELETE of historical documents/lines.

## Reconciliation state contract

`createRunBillingEvidenceReader.read(organizationId, runId)` uses an exact tenant-scoped run FK boundary to correlate provider intent + actual usage ACK + configured/pinned model + rate-version existence. It returns:

- `unknown`: unresolved pre-egress intent, missing ACK, no price provenance, or pre-intent historical usage that cannot be safely attributed
- `estimated`: consistent acknowledged platform NIM/Jev tokens and an existing pinned rate-card model; still only a pricing estimate
- `disputed`: contradictory provider phase or mismatched model/rate-card evidence
- `externally-billed`: acknowledged BYO OpenAI executor; Savant does not claim its provider charges
- `confirmed`: intentionally **unreachable in 7A**. It requires a future independent, verified provider-issued request-level attribution source and financial approvals

The response always sets `actualBilledMicroUsd=null` and `providerInvoiceMatched=false`. Shared-account source lines are **never** joined into per-tenant run money. Account summaries expose unverified model totals solely to the trusted platform operator, not to customer pages. Lack of provider ACK or pending intent is never converted into zero charge.

## TDD/SDD acceptance

- Unit: exact digest vs modified bytes, invalid UTF-8/oversize/schema/currency/model/provider/month, signed BigInt micro-USD boundaries, correction validation, unknown/estimated/disputed/BYO states with no false settlement.
- PostgreSQL (ephemeral loopback, opt-in): two complete migration passes, 12 competing same-source imports, idempotency, source ref conflict and checksum mismatch, credit correctness/overcredit, direct SQL FK and append-only tamper denial, irreversible freeze and post-freeze refusal, two tenant run evidence readbacks and cross-tenant denial, metadata-only storage.
- Existing predecessor suite: Test Bench encrypted case pinning, admitted-run quotas, BYO OpenAI, cancellation, retries, usage receipts, durable intents and versioned rate budgets.
- Blocking GitHub Actions: Node contract tests, TypeScript, ESLint, production Next build, secrets, high/critical dependency audit, PostgreSQL migration and all integrations. A Vercel READY preview proves only build capability; no authenticated NIM/Jev/OpenAI UAT occurs in this scope.

## Operational constraints and follow-on

No Vercel or GitHub production secrets are created/modified by 7A. Live **PER-1426** keys, recovery/rotation drill, **PER-1455** branch rules, independently reviewed provider billing source formats/account IDs, independently reviewed NIM/Jev contract rates, and authenticated provider smoke remain release gates.

7B should implement supported provider export verification (request IDs, trusted signatures or authenticated pull, provider account identity), validation/approval workflow, account-level close, immutable adjustments, and verified request-level reconciliation. Even then, platform shared invoices cannot be assigned to tenants without auditable attribution evidence. Do not treat synthetic fixtures as actual invoices.
