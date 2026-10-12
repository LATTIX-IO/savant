# ADR-0013 — Provider-side reconciliation evidence (PER-1059)

**Status:** Internal read-only reconciliation, not an automated dispatcher, customer-harness connector or production release gate.

## Purpose

A worker that committed `dispatchStarted` may crash, time out or lose provider acknowledgment. ADR-0012 deliberately prevents reclaiming its lease automatically. To begin operator reconciliation safely, Savant must verify provider status by the **original immutable idempotency key**, keep tenant/adapter/run attribution, and persist bounded metadata evidence rather than asking the operator to retry blindly.

Migration `0021_harness_reconciliation_observations.sql` adds tenant/run-scoped reconciliation receipts with unique observation IDs and only SHA-256 idempotency/evidence fingerprints, an allowlisted provider state (`accepted|not_found|unknown`) and timestamp. The composite tenant/run FK and unique scope prevent cross-tenant record grafting. No prompts, responses, raw connector errors, access tokens, or provider payloads are stored.

The server-only `createHarnessProviderReconciliation` requires a trusted injected operator authorization verifier and an authenticated **provider-side lookup** function, which must enforce ownership of the tenant's customer adapter and return attested evidence. The implementation:

1. Validates tenant, adapter, run, operator and observation identity before DB I/O.
2. Authenticates the tenant-scoped operator via an injected security verifier.
3. Reads the authoritative run with a `dispatching` or `reconciliation` lease.
4. Supplies only the run's original idempotency key and trace ID to the trusted verifier.
5. Strictly accepts an allowlisted metadata-only provider response that matches tenant, adapter, run and original key; rejects extra properties and forged getter objects.
6. Under DB run/lease locks, rechecks that the run's identity and held lease state have not changed, then stores one uniquely scoped observation transactionally. Same observation ID and identical evidence is replay-only; changed evidence returns a safe `observation_conflict`.

A provider `not_found` observation is **not** evidence that the provider never executed a job; eventual consistency and provider-specific replay semantics make it unsafe to automatically release, retry or refund a run. In this increment all outcomes retain the dispatch hold and return `manual_reconciliation_required`. Even `accepted` does not promote the run to `running` without a separately verified external run receipt and signed event.

## Verification requirements

- Unit/security tests: untrusted operator, forged tenant/adapter/run ID, invalid observation ID, authorization outage, invalid clock and fail-before-I/O checks.
- PostgreSQL 16 integration: actual reserved and `dispatching` run, original idempotency key passed to verifier, duplicate/conflicting observations, unrelated tenant denial, no automatic retry after expiry or provider `not_found`, composite tenant FK enforcement and cascade.
- Existing migrations reapplied for idempotency, full Node/Python tests, lint, typecheck, production build, secret scan, and blocking high/critical dependency audit must all pass on the PR's exact head.
- Independent security review and real customer-harness lookup attestation tests before this code can be wired into production.

## Remaining PER-1059 scope

Implement a real vault-backed customer connector and authenticated provider lookup/response attestation, authorized reconciliation decisions for a verified provider external run ID, signed completion/cancellation event receipt, and end-to-end baseline/candidate evaluation scoring with budget/cost settlement. No production webhook, background worker supervisor, auto-resume/release or operator UI is introduced here. Do not mark PER-1059 or Savant MVP Done.
