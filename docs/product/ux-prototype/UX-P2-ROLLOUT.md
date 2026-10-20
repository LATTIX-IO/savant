# UX-P2: tenant-aware shell rollout

## Status

Feature-flagged UI implementation, not a new authorization boundary. Built on UX-P1. Canonical production routes and Next.js pages remain unchanged. Prototype local storage and simulated evaluation data are never imported.

## Activation (server side only)

After PR #66 (UX-00) and the **consolidated** implementation PR #73 (UX-01) have passed current-head code/security and authenticated staging acceptance, and safely landed on `main` with v2 initially **disabled**, enable only a small production cohort under the separate UX-08 release gate. Historical PRs #67/#69/#71 are superseded by #73, not additional merge steps:

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
- Before launch: authenticated Playwright journeys at 390, 768, 1280, 1440 in both themes; keyboard navigation, focus management, mobile menu, switching between *two authorized tenants* and denial of a third, archived deep links, zero-data empty states, screen reader labels, and WCAG 2.2 AA.
- The prototype screenshot artifact is a visual reference only; it does not validate the Next.js production shell.

## Rollback

Set `SAVANT_UI_V2_ENABLED=false` (or remove the rollout allowlist) and redeploy/refresh configuration. Classic navigation, routes, database and backend remain intact. No schema or data migration in UX-P2.
