# `apps/api`

Reserved for Savant's dedicated control-plane API once runtime direction is settled.

## Current status

This directory is intentionally code-free during the first integrated beta while Savant gathers runtime evidence.

Until then, the first repo-connect, repo-provision, skill-apply, and sync-trigger endpoints should remain inside `apps/web` so the product can ship without locking the monorepo into an early backend choice.

## Extraction checkpoint

Move code here only after at least one of these becomes true:

- the runtime assessment under `infra/vercel/runtime-assessment/` is complete and recommends a dedicated API target
- `apps/web` route handlers are hitting timeout, cold-start, or memory limits for provider-backed operations
- operational complexity is high enough that a separate API deployment is materially safer

See `docs/architecture/adr-0001-beta-runtime-boundary.md` for the accepted beta-scope decision.
