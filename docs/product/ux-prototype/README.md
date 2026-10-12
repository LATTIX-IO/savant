# Savant UX prototype

A clickable, high-fidelity prototype of the redesigned Savant web app. It is static HTML, CSS and JavaScript with no build step and no backend. All data is sample data, held in browser storage.

Open `index.html` for the UX assessment, the navigation proposal, the capability map and links to every screen.

## Screens

| File | Purpose |
| --- | --- |
| `overview.html` | Attention queue, in-flight runs, quality by tier, skill health |
| `library.html` | Skills, repositories and the marketplace |
| `discovery.html` | Skill opportunities found in observed work (planned) |
| `workbench.html?skill=<id>` | Skill canvas, SKILL.md editor, results and Auto-Improve layers |
| `workflows.html` | Multi-step workflows: graph, validation, test runs, versioned evaluation (planned) |
| `evaluations.html` | Suites, datasets, evaluation builder, Auto-Improve for evaluations (alpha) |
| `runs.html#<run-id>` | Execution inspector: gates, case matrix, step trace |
| `reports.html` | Field reports inbox and reporter status |
| `insights.html` | Version comparison, releases, portfolio |
| `integrations.html` | Source control, model providers, agent clients |
| `settings.html`, `access.html` | Workspace settings, Auto-Improve policy, roles synced from the identity provider |
| `onboarding.html` | Setup guide for a new workspace (Research sandbox) |

## Prototype rules

- Shared state lives in `Savant.db` in `assets/savant.js`. Storage is namespaced per workspace (`sv-wh:*`, `sv-rs:*`), so workspaces never see each other's assets.
- Run status is derived from acceptance gates, and each gate is checked against its own threshold.
- Workflow validation and execution live in `assets/workflow-engine.js`.
- Anything produced by a simulated operation is labelled "Simulated". Planned capabilities are tagged "Planned".
- None of these operations call a real API.

## Tests

```sh
node docs/product/ux-prototype/tests/acceptance.js
```

These 25 checks cover:

- Workbench save and reload
- Idempotent repository indexing
- Evaluation gate correctness
- Workflow validation, branching, approvals and failure policies
- Workspace isolation
- Safe rendering

To run the journey across Library, Workbench, Evaluations, Runs, Insights and Workflows at 1280px and 390px, serve the folder over HTTP and open `tests/journey.html`.
