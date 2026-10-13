# PER-1444 — Atomic UTC daily admission quota (first bounded-cost release gate)

**Status:** draft MVP increment. Does not authorize production release.

## Product and financial honesty

Savant provides QA for externally authored skills and workflows. The Test Bench currently supports real chat-only provider requests using tenant-owned OpenAI or Savant platform NIM and a separate platform Jev judge. The existing two-active-run limit can be bypassed by serial admissions. This increment introduces a second, durable gate: **at most ten new Test Bench runs per tenant per UTC calendar day**, independent of provider selection.

Each new run consumes a conservative **12,000 normalized QA token-unit reservation**, up to **120,000 reserved units per tenant/day**, regardless of whether the run finishes, is canceled, or experiences an uncertain external call. These reservations are deliberately nonrefundable in this MVP slice. An existing identical idempotency UUID replay returns the same receipt even after the daily limit is exhausted and consumes no further reservation.

**This is NOT a hard cap on actual OpenAI/NIM/Jev tokens, provider dollar spend, daily invoices or future tool/harness side effects.** Some provider calls can consume tokens before the worker notices a budget overrun. Actual provider pricing, post-request reconciliation and per-tenant cost settlement remain in PER-1441. UI/API use `normalized-admission-reservation` and explicitly warn against interpreting the number as a spend guarantee.

## Durable contract

Migration 0028 creates `test_bench_daily_admissions` keyed by `(organization_id,utc_day)`, with cascade-on-delete tenant FK and checks enforcing `0..10 admitted_runs`, `0..120000 reserved_normalized_tokens`, and **exactly 12000 units per run**. No input from a browser, tenant header, provider result or client clock determines the ledger key. All day bucketing uses PostgreSQL `(now() at time zone 'UTC')::date`; midnight reset is surfaced as a UTC timestamp.

A single `INSERT ... ON CONFLICT DO UPDATE ... WHERE` reserves one run and 12k units atomically in the *same SQL transaction* as run receipt, sealed case snapshot, queue job and metadata-only audit. The first step within that transaction already checks the caller's request UUID for an exact idempotent replay; only a **new** run reaches the reservation. If any later step fails, PostgreSQL rolls back the reservation and run/job/audit as a unit.

The existing active cap of two runs/tenant, max four cases/run, source pinning, BYO credential pinning, role authorization and same-origin POST remain in force. A fresh run rejected for capacity is HTTP 429 with fixed `test_bench_daily_quota_exceeded` code and no new job. Canceled/failed/expired runs do not credit their quota back, preventing retry storms or unconfirmed paid provider duplication.

## API and UI

`GET /api/test-bench/quota?workspaceSlug=...` requires a live active authenticated tenant and Git view permission, returns `Cache-Control: no-store`, and returns only quota counters, UTC reset time and the nonrefundable accounting marker. It returns no raw prompts, outputs, model credentials, provider price metadata or another tenant's ledger. The Test Bench screen shows remaining admissions and the explicit normalized-only warning; the server enforces the quota regardless of cached UI state.

## TDD and release acceptance

1. Unit: fixed cap consistent with current execution token ceiling, UTC reset contract, invalid/overdrawn records fail closed and no-dollar marker.
2. Client/server regression: authenticated tenant and Git permission before read, `no-store` and same-origin-only client, strict returned quota shape and disallow foreign/malformed workspace.
3. PostgreSQL: isolated localhost database, migration applied twice; transaction rollback leaves no reservation; invalid suite/revision leaves no reservation; concurrent 12-call contention permits at most two active jobs and counts exactly those reservations; 10 terminal canceled runs consume 120k units; 11th denied 429; identical replay after full cap returns previous receipt without extra charge; member and foreign-tenant attempts cannot reserve or discover the victim ledger; database CHECK blocks direct overdraw; no raw case or API key appears in jobs or audit.
4. Exact-head Node/lint/type/Next/secret scan, full existing tenant/crypto/harness/Test Bench regression suite, isolated PostgreSQL migration and quota integration, **blocking high/critical production dependency audit**, Vercel preview READY, independent review.
5. This slice does not provision missing encryption keys, perform live Auth0/NIM/OpenAI/Jev provider acceptance, implement full connection/entitlement policies, or merge other PR stacks. Release gates in PER-1426, PER-1441 and PER-1059 remain outstanding.

## Follow-on production work

Versioned tenant plan entitlements and quota overrides; global platform-provider capacity across tenants; model-specific pricing/rate-card snapshots; measured authoritative provider usage; atomic real spend reconciliation; recovery of uncertain in-flight provider requests; alerting, dispute/audit and backup/restore. Until those ship, production UI and marketing must not advertise guaranteed dollar budgets or full customer-harness workflow quality measurements.
