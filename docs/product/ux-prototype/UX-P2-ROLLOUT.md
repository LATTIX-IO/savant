# UX-P2: tenant-aware shell rollout

## Status

Feature-flagged UI implementation, not a new authorization boundary. Built on UX-P1. Canonical production routes and Next.js pages remain unchanged. Prototype local storage and simulated evaluation data are never imported.

## Activation (server side only)

After PR #66 (UX-00) and **consolidated** implementation PR #73 (UX-01) pass exact-head CI/security, merge source with v2 **disabled**. The single owner may then enable only one or two **verified synthetic production workspaces** under a separate, reversible canary gate, and run authenticated read-only production UX acceptance. Full staging is deferred, not silently counted as complete. Historical PRs #67/#69/#71 are superseded by #73, not additional merge steps:

```dotenv
SAVANT_UI_V2_ENABLED=true
SAVANT_UI_V2_WORKSPACES=example-workspace-slug
```

With no variables, or without a workspace match, the original UI renders. `SAVANT_UI_V2_WORKSPACES=*` enables all authenticated tenant workspaces *only if* explicitly coupled to `SAVANT_UI_V2_ENABLED=true`. Never enable `*` for the initial rollout. Changing a flag needs a deployment/config refresh; this is not an instant per-browser emergency kill switch.

This is a **UI exposure flag**, never an authorization grant. `resolveTenantMembershipForUser` must succeed before server-side flag selection and shell data fetch. The unscoped `/(app)` legacy layout stays classic. Governance visibility uses the existing `isGovernanceFeatureEnabled` gate. Other restricted settings remain controlled inside the existing screens.

## Preserved application routes

All existing routes remain reachable through a consolidated sidebar: Overview `/dashboard`; Library `/skills`, `/repositories`, `/catalog`; Quality `/evaluations`, `/intelligence`, `/releases`; Integrations `/router`; Administration `/settings`; Governance `/connectors`, `/policies`, `/audit` only when enabled.

**No fake destination:** prototype-only `/workbench`, `/runs`, `/workflows`, `/discovery` and `/reports` are not added. Skill detail and evaluation detail still work via existing deep links. A topbar “Find skills” link is a real link to Skills, not an inert pretend search field.

Workspace switching keeps only safe collection routes and otherwise navigates to the new workspace dashboard, never carrying a potentially private skill/evaluation ID between tenants. The target tenant is independently authorized by its page/layout.

## Test and review matrix

- Node tests: default-off and explicit allowlist, safe navigation, real zero-vs-unavailable counts, feature gating, safe cross-workspace switching, tenant-aware breadcrumbs, negative source checks.
- Existing full `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, secret-scan and PostgreSQL tenant-integrity CI must be green at the exact PR head.
- Security review: no query/localStorage override of rollout, no authorization changes, no injection of untrusted strings into route destinations.
- Before enabling the pilot: real Auth0 Playwright journeys at 390, 768, 1280, 1440 in both themes with explicit owner-only read-only production acknowledgment, keyboard/focus/mobile navigation, switching between *two authorized synthetic tenants* and denial of a third, deep links, empty states and screen-reader checks. This evidence is not implied by a successful source merge.
- The prototype screenshot artifact is a visual reference only; it does not validate the Next.js production shell.

## Owner-operated production pilot

Use `docs/product/ux-p1-p4-authenticated-acceptance.md` for the explicit read-only production opt-in and genuine session requirements. A source merge changes no runtime exposure when the two server variables are absent. Do not claim that Vercel READY, static prototype screenshot tests or local browser mocks qualify the live experience. Do not enable `SAVANT_UI_V2_WORKSPACES=*` during owner testing. Record production exact SHA, applied allowlist, negative tenant checks and rollback before increasing exposure.

## Rollback

Set `SAVANT_UI_V2_ENABLED=false` (or remove the rollout allowlist) and redeploy/refresh configuration. Classic navigation, routes, database and backend remain intact. No schema or data migration in UX-P2.
