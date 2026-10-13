# Capability status

What the prototype shows compared with what production `apps/web` provides on `main` (`80e75b3`). The prototype is a design reference: everything in it runs on browser storage and sample data, including features that exist in production.

| Status | Meaning |
| --- | --- |
| **Operational** | Implemented end to end in `apps/web` (API, persistence and UI). The prototype redesigns the experience. |
| **Partial** | Exists in production but is read-only, disabled or under-surfaced. The prototype designs the complete interaction. |
| **In review** | Being built in open pull requests that are not merged. Not available on `main`. |
| **Planned** | No production implementation. The prototype is a forward-looking design and is tagged "Planned" in the UI. |

## Matrix

| Capability | Prototype screen | Status | Production notes |
| --- | --- | --- | --- |
| Git connections, repository sync and assessment, fix proposals | `library.html` (Repositories), `integrations.html` | **Operational** | `server/git/providers/*`, repositories screen |
| Skill inventory, detail, versions and dependencies | `library.html`, inspector drawer | **Operational** | `catalog.tsx`, `skill.tsx` (8 tabs, to be split) |
| Public skill hub with safety verdicts and import | `library.html` (Marketplace) | **Operational** | `skill-hub.tsx` |
| Evaluation results and dataset generation | `evaluations.html`, `runs.html` | **Operational** | `evaluations.tsx`, `evaluation-detail.tsx` |
| Improvement proposals with review (approve, reject, modify, request testing) | `workbench.html` (Improve layer), notifications | **Operational** | `improvement_recommendations`, `recommendation_reviews` |
| Skill router tokens and AI connections | `integrations.html` | **Operational** | `skill-router.tsx`, Settings → AI providers |
| Launching an evaluation from the UI | `evaluations.html` builder | **Partial** | "Run evaluation" is disabled in production |
| Releases, policies, audit and connectors | `insights.html` (Releases), `settings.html`, `integrations.html` | **Partial** | Read-only APIs; some screens are dev-only |
| Persisted evaluation status, pinned evaluation sources, Test Bench definitions and bounded execution | `evaluations.html`, `runs.html` | **In review** | PRs #62–#65, an open draft stack |
| Step-level execution traces | `runs.html` | **Partial** | Run artifacts exist. Show per-step detail only where telemetry provides it. |
| Acceptance gates computed per threshold | `runs.html` | **Planned in UI** | Gate outcomes must come from persisted evaluation results, not the browser |
| Workspace-isolated data | all screens | **Operational** | Server-derived workspace membership. The prototype's per-workspace storage only models this. |
| Field reports and reporter status | `reports.html` | **Partial** | `skill_feedback` and `report_skill_outcome` exist; there is no triage UI |
| Auto-Improve per-tier policy, auto-approval, recursive iterations | `settings.html`, `workbench.html` | **Planned** | |
| Auto-Improve for evaluations (alpha) and eval drift | `evaluations.html` | **Planned** | |
| Roles synced from the identity provider (SCIM) | `access.html`, `settings.html` | **Planned** | Auth0 sign-in and role bindings exist; there is no SCIM sync |
| Skill opportunities from observed work | `discovery.html` | **Planned** | |
| Multi-step workflows: graph, validation, test runs, versioned evaluation | `workflows.html` | **Planned** | The prototype's engine and graph hash are demonstration code, not production execution or provenance |
| Scheduled, on-candidate and harness-executed evaluations | `evaluations.html` builder | **Planned** | |

## Rules for implementation

- Production services are authoritative for evaluation results, approvals, release state, workflow receipts and credentials. The browser never is.
- Where production lacks data the prototype shows (for example per-step traces or a metric), show an explicit unavailable or empty state. Never synthesise values.
- Keep "Planned" and "Simulated" labelling until a capability is operational on `main`.
