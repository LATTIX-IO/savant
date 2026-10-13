# PER-1409 — Merge-safe production dependency gate for Savant Test Bench

**Status:** Draft, pending exact-head blocking audit and independent release-security review.

## Why this increment exists

Savant has two independent chains from `main`: customer-harness adapter #45→#61, with PER-1409 security remediation in #46; and persisted Test Bench #62→#68, which inherited the original vulnerable Next.js 16.2.6 and lacked the high/critical dependency audit. A READY Vercel preview or legacy "Security checks" GitHub job did not establish safe deployability of the Test Bench chain.

This increment reuses the *exact* vetted dependency contents of PER-1409 PR #46 without pulling unrelated harness changes or changing Test Bench behavior.

## Implementation

- Copy the audited `apps/web/package.json`, `pnpm-workspace.yaml` and `pnpm-lock.yaml` from `feature/per-1409-dependency-remediation`: Next.js + `eslint-config-next` **16.3.8** and patched same-major resolutions for `postcss`, `nanoid@3`, `browserslist`, and `source-map-js`. No in-build lockfile generation or silent dependency updates.
- Add a **required blocking** production dependency audit job to `.github/workflows/savant-typescript.yml` using Node 24 and pnpm 10.30.0, `pnpm install --frozen-lockfile` and `pnpm run security:deps` (`pnpm audit --prod --audit-level high`).
- Add Node contract/regression tests for app/lockfile Next+ESLint consistency, every transitive override, and CI audit visibility/non-suppression. Retain all prior Test Bench and tenancy unit, migration, concurrency, authenticated request and encrypted evidence tests.

## Evidence required before merge

- Completed exact-head `Savant unit, type, lint, build and secrets`, `Workflow schema migration and tenant integrity`, blocking `Blocking production dependency audit (high/critical)` and Vercel preview checks.
- Report the actual audit success/failure and advisories, not an assumed zero due to a version bump. Distinguish this scan from the inherited legacy Rust security job, which has skipped work.
- Independent security approval of the dependency and lockfile diff (including transitive changes) and a production-compatible preview smoke for auth, Test Bench read/save/execute/cancel and Next Image/OG endpoints if used.
- Securely configure environment-specific `TEST_BENCH_ENCRYPTION_KEY` via the deployment secret manager, prove backup/restore and rotation, and run live authenticated NIM/Jev tenant end-to-end acceptance before promotion. None of these steps are performed by this code-only PR.

## Rollback

If the upgraded Next.js runtime regresses, use a previously built, verified deployment as the rollback target and treat any reversion to 16.2.6 as a security exception requiring incident/security-owner approval. Do not disable the dependency audit to force release. Preserve database schema backward-compatibility and independently verify restores before making `main` production-authoritative.

## Remaining MVP product scope

This work is a **release security gate**, not a new harness, inference router, or security differentiator. External customer-harness invocation, durable signed provider results, paired baseline/candidate evaluation with meaningful statistical interpretation, and first-customer onboarding remain separate acceptance milestones.
