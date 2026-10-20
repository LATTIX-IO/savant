# PER-1452 — shared-provider daily admission protection

## Threat and boundary
The prior tenant-local daily quota cannot prevent many distinct tenants from exhausting Savant's shared NIM and Jev allocations. A tenant-owned OpenAI credential still consumes Savant's Jev judge. This increment adds atomic, global *admission reservations*; neither normalized units nor provider acknowledgement amounts guarantee actual provider billing.

## Admission invariants
- Immutable, server-defined modes: `platform-nim` reserves 1 Jev and 1 NIM admission; `workspace-openai` reserves 1 Jev and 0 NIM.
- Fixed UTC-day ceilings: Jev 200 run admissions; NIM 100. Each reservation increments a 12,000-unit accounting proxy, separate from real tokens, rates and invoices.
- Linearizable conditional PostgreSQL UPSERT for every provider, in constant order Jev -> NIM, in the *same transaction* as PER-1444 tenant allocation, frozen run snapshot, background job and redacted audit. Failure anywhere rolls back every reservation. Exact replay checks precede reservation and do not double-consume.
- Cancellation and provider failure do not refund admissions because unknown external side effects may still be billable.
- A full shared pool returns `test_bench_platform_capacity_exceeded` (429), without publishing global occupancy to tenants. No user-controlled provider identifiers; ledger stores only provider/day/counts.
- All transactions are backed by database CHECK limits and unique provider/day primary key. Cross-process concurrency must not permit overdraw.

## Evidence / acceptance
CI runs node contract tests and isolated PostgreSQL `verify-platform-provider-admission.mjs` after two schema migration passes, existing tenant daily quota and usage-receipt regressions. The isolated test proves rollback, cross-mode partitioning, all-or-nothing Jev+NIM reservation when NIM is full, 12-way one-slot contention, SQL tamper denial and metadata-only records.

**Release gate:** Independent review, exact-head all-green CI, Vercel READY and authenticated multi-tenant real NIM/OpenAI/Jev smoke are required. Provision, validate and rehearse restore/rotation of managed `TEST_BENCH_ENCRYPTION_KEY` and `AI_CONNECTION_ENCRYPTION_KEY`. The ceilings require operator/provider capacity acceptance before production; they are not dollar caps. Parent PER-1441 remains open for entitlements, provider pricing, actual settlement and uncertain-call reconciliation.

## Rollback
Keep PR draft until acceptance; do not activate by merging the dependent draft stack. Migration 0030 creates only the additive metadata ledger. Do not drop or rewrite existing admission records in an active deployment.
