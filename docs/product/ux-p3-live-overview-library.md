# UX-P3 — Live Overview and Library

**Implementation branch:** `feature/ux-p3-live-overview-library`  
**Stack base:** UX-P2 `feature/ux-p2-tenant-aware-shell` (PR #69), which depends on UX-P1 (PR #67). UX-P0 prototype reference is PR #66.

## Scope and live-data contract

- Reuse the production `/o/[workspaceSlug]/dashboard` and `/o/[workspaceSlug]/skills` routes. No new public route, schema or backend service.
- Render the new Overview and Library only inside `UiV2ModeProvider` attached to the authenticated, server-enabled UX-P2 shell. Default and unscoped legacy paths continue using the old screens.
- Overview renders only the `getOverviewResponse(tenantContext)` payload supplied by the server, with the returned source-of-truth metadata. No browser-derived acceptance, quality or release signals. Missing rates with no denominator show *Not available*, not a fake zero.
- Library uses the existing, workspace-scoped `fetchSkillList` and `fetchRepositoryList` clients with `AbortController` cleanup, independent loading/error/empty states and explicitly associated workspace scope on every result. Never carry stale prior-tenant results into the next tenant's UI.
- Skill links reuse `buildSkillDetailPath`, which uses the canonical skill UUID. Repository management and marketplace links point to existing routes. The connect action reuses the current onboarding dialog; new skill uses the production SkillCreateModal.
- A connected repository without `projection.indexedAt` is **Not indexed** even if the provider connection reports ready. No fabricated scores, counts, date of index or client-trusted approvals.
- Store no data in browser storage. Authorization is still checked by the existing route layout and tenant-scoped API handlers.

## Out of scope

A distinct production Workbench, approval editor, multi-step workflow runner, automated optimization, new API endpoints, cross-provider import wizard, global search service, new repository CRUD or a redesign of Marketplace. These retain their existing routes until later increments.

## Definition of done

- [ ] All new pure selector/filter/provenance unit tests pass, including hostile names and unknown/invalid metric values.
- [ ] Negative regression/security checks confirm the new screens fetch only through existing live clients with explicit workspace scopes, abort in-flight requests on scope changes, and cannot be enabled from browser state.
- [ ] Full existing Node test suite, ESLint, strict TypeScript, Next.js production build, secret scan and PostgreSQL tenant integrity CI pass on exact head.
- [ ] Independently review the PR and inspect *authenticated* Vercel/staging screenshots at 390, 768, 1280, 1440px in light/dark.
- [ ] Authenticated E2E: workspace A and B with disjoint assets; denied workspace C; skill detail and repository navigation; empty, API 403, API 503 and stale-after-scope-switch responses; keyboard/table scroll and screen reader semantics.
- [ ] Inherited dependency audit/release check and UX-P0/P1/P2 reviews/merges pass before staging or production cutover.

## Rollback

Disable `SAVANT_UI_V2_ENABLED` or remove the workspace from `SAVANT_UI_V2_WORKSPACES`, redeploy/reload configuration and return to the original UI. No persisted client preference or DB migration to revert.
