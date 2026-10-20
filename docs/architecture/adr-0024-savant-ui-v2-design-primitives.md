# ADR-0024: Scope the UX-P1 design system to the application

**Status:** Proposed (UX-P1)

## Context

The reviewed Savant UX prototype in `docs/product/ux-prototype` supplies the desired visual reference. Production is a Next.js 16/React 19 application with existing light/dark theme handling, authenticated workspace layouts, data clients, and a separate marketing site. Copying the prototype's global CSS or browser state into `apps/web` would overwrite live controls and weaken state provenance.

## Decision

Create an opt-in `UiV2Surface` with a CSS module, local `--sv2-*` design tokens, IBM Plex Sans/Mono via `next/font/google`, and composable native HTML controls. The surface inherits the application's existing `html[data-theme]` theme and explicitly supports compact/comfortable density. Do not introduce new global CSS, route changes, feature flags, API clients, or data stores in this increment. A future UX-P2 shell will mount the opt-in surface behind a rollout gate; this increment is intentionally inert for existing screens.

Status primitives must always disclose `Planned`, `Simulated` and `Unavailable`; missing numeric evidence is displayed as `Not available` rather than zero. Internal navigation is restricted to safe rooted paths. Native button/input/link semantics are retained. These are presentation-only invariants: real authorization and capabilities remain server-side.

## Verification

- Node contract, regression and security tests in `contracts.test.ts` executed by `pnpm test`.
- TypeScript, ESLint, production Next.js build and secrets/dependency checks on the exact PR head.
- Review light/dark, mobile and keyboard/focus visuals when the surface is mounted by UX-P2. Do not claim screenshot parity from unmounted components.

## Rollback

Revert the isolated UX-P1 commit(s); no database migration, API change, persisted setting or route needs rollback.
