# Production UI modernization: migration plan

**Reference:** `docs/product/ux-prototype` (approved visual and interaction reference)
**Implementation:** `apps/web`, using Next.js 16, React 19 and TypeScript
**Delivery:** incremental, behind the `savant-ui-v2` flag, on short-lived PR branches from `main`

## Architectural decision

Reimplement the prototype's patterns as React and TypeScript components in `apps/web`. Do not embed the prototype HTML or import its browser-state code. The production application stays authoritative for:

- authentication and workspace membership
- data ownership and repository indexing
- source revisions and evaluation outcomes
- workflow specifications
- approvals and audit evidence
- credentials

## Navigation

| Destination | Responsibility | Reuse |
| --- | --- | --- |
| Overview | Operational health and attention queue | `screens/overview.tsx` |
| Library | Skills, repositories, marketplace, opportunities | `catalog.tsx`, `repositories.tsx`, `skill-hub.tsx` |
| Workbench | Authoring, dependencies, version review | `skill.tsx`, skill builder |
| Evaluations | Suites, datasets, definitions, launch | `evaluations.tsx`, `evaluation-detail.tsx` |
| Runs | Results, telemetry, traces | Evaluation detail, skill intelligence, run APIs |
| Insights | Comparison, regressions, cost, releases | `intelligence.tsx`, `releases.tsx` |
| Integrations | Source control, AI providers, router clients | `connectors.tsx`, `skill-router.tsx` |
| Administration | Members, access, policies, audit, billing | `settings.tsx`, governance screens |

- Keep existing URLs and add redirects for legacy routes under `/o/[workspaceSlug]/…`.
- Update deep links only after verifying they keep skill IDs, evaluation IDs, repository context and the selected tab.
- Never hide mandatory governance actions.

## Increments

| Increment | Scope | Definition of done |
| --- | --- | --- |
| **UX-P0** | Merge the reference; add prototype acceptance tests and browser journeys with screenshots to CI; document capability status | Reference on `main`, CI green, screenshots reviewed, no production code changed |
| **UX-P1** | Design tokens and shared components, scoped to the app (not marketing), with light and dark themes and IBM Plex | Accessibility and visual-regression coverage; current screens unchanged |
| **UX-P2** | App shell, navigation, breadcrumbs, workspace switcher and search, behind the flag | Every existing function reachable and permission-gated; legacy deep links valid |
| **UX-P3** | Library and Overview on live repository and skill APIs | Connect or access a repository, see indexed skills and failures, open a skill with context preserved |
| **UX-P4** | Workbench: split `skill.tsx` into shell, asset navigator, editor, dependencies, inspector | Open any authorized skill, edit through supported operations, reload safely |
| **UX-P5** | Evaluations and Runs: definitions, execution and results separated; persisted gates | Results survive reload, are tenant-isolated, deep-link correctly; no synthetic scores |
| **UX-P6** | Insights, Releases, Auto-Improve proposals | Every comparative claim traceable to evidence; release controls unchanged |
| **UX-P7** | Integrations, Settings, Onboarding | State consistent across screens after reload; planned admin features labelled |
| **UX-P8** | Workflow editor preview on `WorkflowSpecification` and Git-owned artifacts | Author, validate, save and reopen a spec; no implied runtime execution |

## Execution order and dependencies

1. **UX-P0** comes first.
2. **UX-P1** and **UX-P2** follow, on separate branches.
3. **UX-P3 to UX-P7** can proceed in parallel once the token and shell contracts are stable.
4. **UX-P5** integrates PRs #62–#65 only after they merge in dependency order.
5. **UX-P8** comes last.

## Test gates for each increment

- Unit and contract tests
- Integration tests against real APIs, including failure modes
- Security tests: tenant boundaries, unsafe rendering, CSRF and origin checks, provenance
- End-to-end journeys
- Visual regression at 390, 768, 1280 and 1440px, in light and dark themes and both densities
- WCAG 2.2 AA checks
- Build, lint, typecheck, dependency scans, independent review, Vercel preview and rollback readiness

Tests must distinguish mocked UI fixtures from tests against persistent services.

## Rollout

1. Development, then staging, then a controlled production cohort, all behind `savant-ui-v2`.
2. Keep old routes until each replacement passes operational acceptance.
3. Rolling back the UI must not require reverting migrations or weakening authorization.

**Cutover criterion:** all six primary journeys work against production services, unsupported states are represented truthfully, security and accessibility gates pass, and rollback has been exercised.
