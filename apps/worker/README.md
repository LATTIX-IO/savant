# `apps/worker`

Reserved for Savant's background jobs, scoring pipelines, bundle packaging, and connector orchestration.

## Current status

No worker implementation has been added yet.

The first runtime decision for background processing will be made after the Rust vs Python on Vercel assessment documented in `docs/architecture/runtime-assessment.md`.

For the first integrated beta, prefer the lightest job mechanism that can provide retries and idempotency without introducing a separate deployment target prematurely. Extract queue-driven or long-running execution here once benchmark data or production pressure shows that `apps/web` is no longer a safe host for those workloads.

See `docs/architecture/adr-0001-beta-runtime-boundary.md` for the accepted beta-scope decision.
