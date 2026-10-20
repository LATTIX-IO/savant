# UX-02 — Canonical tenant navigation and deep-link parity

**Increment:** PER-1580 · PR #107 · Production UI v2 remains server-flag **OFF** until separate authenticated owner-only canary acceptance. This is a source-only navigation increment; no database, cryptographic key, provider or Auth0 session mutation.

## Canonical application routes

The route registry in `apps/web/src/lib/ui-v2-shell-model.ts` represents **existing** Next.js pages and must be reconciled against `apps/web/src/app/o/[workspaceSlug]` on each future change. The running application, workspace membership and server APIs remain authoritative.

| Navigation group | Current tenant route | Runtime implementation | Detail path |
| --- | --- | --- | --- |
| Workspace | `/dashboard` | Existing server Overview; v2 overview only after server allowlist | — |
| Library | `/skills` | Server skill catalog; v2 Library only after allowlist | `/skills/[id]` uses v2 single-file Git Workbench or classic |
| Library | `/repositories` | Existing classic repository management | None |
| Library | `/catalog` | Existing marketplace catalog | `/catalog/[id]` (legacy screen) |
| Quality | `/evaluations` | Existing evaluation + Test Bench screens | `/evaluations/[uuid]` (legacy screen) |
| Quality | `/intelligence` | Existing insights/intelligence screen | None |
| Quality | `/releases` | Existing reviewed release management | None |
| Integrations | `/router` | Existing router screen | None |
| Governance | `/connectors`, `/policies`, `/audit` | Existing feature-gated pages (not production-visible without real backend feature enablement) | None |
| Administration | `/settings` | Existing server settings/role enforcement | None |

**No fake routes:** prototype-only `/runs`, `/workflows`, `/discovery`, `/reports`, `/workbench` are not added to production. “Evaluations and runs” is a link to the real `/evaluations` page; it is not a runtime trace viewer or agent scheduler. “Find skills” is a link to the real Library, not a global-search input.

## URL, provenance and authorization invariants

1. The tenant layout calls `resolveTenantMembershipForUser` before applying the v2 flag. The shell's route resolver is **presentation validation only**, never an Auth0, workspace/RBAC, data, or Git authorization grant. All actual 403/404 and resource access checks remain in the Next page/API.
2. The canonical route table recognizes only exact existing collections and one-segment detail IDs for Skill, Evaluation and Marketplace. Unknown, nested, encoded traversal, query-in-path, hash-in-path and external-looking locations cannot create active navigation or unexpected breadcrumb links. Next.js/server still supplies the final HTTP 404.
3. Existing same-workspace bookmarked `/skills/[id]`, `/evaluations/[uuid]`, and `/catalog/[id]` stay routable and use their original backend. The canonical active section and breadcrumb reflect the valid detail route, not a misleading Overview state.
4. On a workspace switch, **only exact collection routes** may be carried forward. Resource IDs, tabs, query strings and arbitrary redirects are discarded to `/dashboard` to avoid carrying tenant-specific context to another organization. The next tenant is separately membership-authorized server-side. Source queries and tabs on ordinary **same-workspace** in-app routes remain managed by the existing Next/React screen; this increment does not mutate browser history/query state.
5. A client-side page or workspace route change focuses the `<main>` landmark without scrolling, preserving readable keyboard and screen-reader navigation. Initial hydration does not steal focus. Escape closes the native workspace menu and restores summary focus. Browser Back/Forward is exercised against a real authenticated browser state by the operator's UX acceptance runner.
6. Governance links are gated by existing `isGovernanceFeatureEnabled`, and **all** restricted actions remain controlled by their existing page/API RBAC checks. The navigation does not infer or invent privileges from client-supplied claims. Existing non-v2 screens remain available through their canonical URLs.
7. Empty/null metrics are preserved exactly as the server provided them; missing/failed data is not an “observed zero.” Workbench Git changes remain pending-review proposals only, and static prototype graph data is never imported into the runtime.

## Acceptance and rollback

Automated source qualification must pass exact-head TypeScript, Node units, strict lint, Next build, committed-secret scan, high/critical dependency audit, PostgreSQL tenant/security integration, existing prototype/Playwright suite, and Vercel READY preview. Unit tests enumerate real Next tenant files and hostile route/tenant-switch cases.

The operator-run `apps/web/scripts/ux-v2-authenticated-acceptance.cjs` requires a **real** Auth0 session stored outside the repository and an approved synthetic workspace A, B, denied C and an eligible Git skill. It must test 390/768/1280/1440 in light/dark, navigation, Workbench browser history, deny A's skill in B and deny C; it makes no provider or Git mutations. No session is stored in Git or PR artifacts. **A clean CI build does not mean this live suite has been executed.** Separate PER-1585/1586 own authenticated production pilot, WCAG and canary activation.

Source merge with `SAVANT_UI_V2_ENABLED` absent has no v2 exposure. If an owner-only synthetic canary is later enabled, rollback by setting `SAVANT_UI_V2_ENABLED=false`, removing the explicit workspace allowlist and redeploying; the classic routes, data and APIs are untouched. Production Test Bench schema/key readiness belongs independently to PER-1592/PER-1421.
