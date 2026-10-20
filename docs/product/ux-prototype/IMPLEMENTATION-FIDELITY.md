# Savant v2 reference-to-implementation contract (PER-1593)

**Source**: UX-00 `docs/product/ux-prototype/` + `assets/savant.css`. These files are static/sample UX references, **never** production state, services or code imports. `apps/web` owns live user interfaces, Auth0 tenant membership, server-authorized APIs, Git revisions and PostgreSQL receipts.

**Design system**: `apps/web/src/components/savant/ui-v2/operational-tokens.module.css` contains the only v2 app operational color and typography tokens, mounted through `UiV2Surface`; `ui-v2.module.css` consumes semantic variables. Preserve `apps/web/src/styles/tokens.css` and classic/marketing scopes unchanged. Shared primitives include PageHeader, Panel, Metric, Status, StateBanner, NavigationTabs, Breadcrumbs, Dialog, InspectorDrawer, SplitPane, CanvasRegion, TableViewport, Field, EmptyState. Native dialog owns accessible keyboard/focus handling; read-only canvas never implies actual workflow execution.

## References and capability owners

| Reference | Critical UX target | Authoritative app owner | Release status |
|---|---|---|---|
| `index.html` | six workspaces + two admin, prototype map | `ui-v2-shell-model` | F1 outstanding |
| `overview.html` | measures, attention queue, in-flight, health matrix | `OverviewV2` + control plane | Partial, F2 |
| `library.html` | skills, repositories, marketplace, inspector | `LibraryV2`, skill hub + repo APIs | Partial, F2 |
| `workbench.html` | source tree, canvas/code/split, inspector | `WorkbenchV2` + Git review | Partial, F3 |
| `evaluations.html` | suites, datasets, builder, gating | Test Bench + evaluation APIs | Partial, UX-03 |
| `runs.html` | case matrix, receipt/drilldown, traces | Observed Test Bench receipts | Dedicated route absent, UX-04 |
| `insights.html` | compare, releases, portfolio | intelligence/release endpoints | Classic, UX-05 |
| `integrations.html` | source/model/router/distribution topology | provider/repository/router APIs | Classic, UX-06 |
| `settings.html` | general, roles, policies, audit, billing | settings/governance APIs | Classic, UX-06 |
| `access.html` | access matrix, user check, sync | membership/RBAC API | SCIM planned, UX-06 |
| `onboarding.html` | connect/index/provider/first run | onboarding and authenticated BFF | Partial, UX-06 |
| `discovery.html` | opportunities and work patterns | no accepted event ingestion | Planned, UX-10 |
| `reports.html` | field report inbox and triage | feedback and report APIs partial | Planned, UX-10 |
| `workflows.html` | graph specification, validation, versions | no production workflow executor | Preview only, UX-09 |

Prohibited: client-local simulated evaluations, fake costs, fabricated spans, mock SCIM, automatic release approval. Unknown measures must be Not available, not zero.

**Release gates**: exact-head CI/test/typecheck/lint/build + dependency/secret/tenant checks; 390/768/1280/1440 light/dark browser/keyboard visual review; owner-authenticated A/B/denied C and 403/409/429/503 tests; immutable source and provider evidence; rollback. PER-1592/1421 are prerequisites for real Test Bench execution, not F0 display primitives. No UI flag, schema or production configuration change in F0.
