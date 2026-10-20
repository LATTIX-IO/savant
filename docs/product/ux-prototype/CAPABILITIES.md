# Savant UX capability status

**Verified source baseline:** `main` at `3404fc7948bc24e5b436a45f57e3c31daea5ca1e` (October 20, 2026), including PRs #101–#106: Test Bench/provider source, sole-maintainer governance scaffolding and the owner-authorized production-first schema admission code. **The schema has not been activated in production.** UI PRs #66/#73 remain separate until source integration; the current state must be verified again after every merge. This is a versioned implementation inventory, **not** an assertion of deployed production readiness.

The 13-page HTML/CSS/JS prototype is a visual and interaction reference containing **sample/browser-stored data and simulated actions**, including where a corresponding real API exists. Its green static tests do not establish authenticated tenant access, genuine provider evaluation, effective access controls, billing accuracy, or production release.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **Classic operational** | Code exists on `main` and is exposed through an existing authenticated app route, subject to runtime configuration/entitlements and appropriate environment qualification. |
| **Merged, operationally unqualified** | Production source is on `main`, but required protected staging, managed keys, schema promotion or real tenant/provider end-to-end acceptance are still outstanding. Do **not** call this released. |
| **Partial** | Only some interactions, providers, telemetry or administrative states are supported. Unsupported paths must be explicit. |
| **Flagged UI source** | Proposed in PR #73; source merge alone does not enable the production v2 shell. Availability requires the server-selected allowlist and authenticated owner acceptance. |
| **Planned** | Prototype-only or not yet available as a verified production feature; do not simulate success in production. |

## Capability-to-screen traceability

| Capability | Prototype reference | Source / deployment status | Authoritative contract and limitations |
| --- | --- | --- | --- |
| Git provider connections, repository sync, source assessment | `library.html` / `integrations.html` | **Classic operational** | Existing repositories/Git provider screens and tenant-scoped BFF. Real indexing status comes from server, not a browser counter. |
| Workspace skill inventory and source/version detail | `library.html` / `workbench.html` | **Classic operational** | Existing skill/catalog details. V2 Overview and Library exist in **draft PR #73**. |
| Public skill marketplace and imports | `library.html` | **Classic operational** | Existing `skill-hub.tsx`, authorization and safety outcomes; v2 does not invent marketplace data. |
| Git-backed skill edit/review proposals | `workbench.html` | **Classic operational / Draft UI** | V2 Workbench in PR #73 supports **one indexed SKILL.md** and creates a **pending approval proposal**; it does **not** merge/publish a commit, edit an entire source tree, or execute a graph. Legacy direct commit is deliberately read-only in v2 pending a revision-safe server contract. |
| Existing evaluation results and dataset generation | `evaluations.html` / `runs.html` | **Classic operational / Partial** | Existing evaluation detail and live generation screens. Provider-specific generation capabilities are not equivalent to generic executable tool/agent workflows. |
| Persisted, revisioned Test Bench case suites | `evaluations.html` | **Merged, operationally unqualified** | `persisted-test-bench.tsx` and PostgreSQL/API code from PR #101; requires real database recovery/production schema activation and distinct recoverable encryption keys under PER-1592 before live execution. Full PER-1556 staging/KMS recovery is post-pilot hardening. |
| Real observed Test Bench execution, cancellation, quota and usage evidence | `evaluations.html` / `runs.html` | **Merged, operationally unqualified** | `observed-test-bench-run-panel.tsx`, tenant-owned permitted provider/harness, bounded cases and costs. Uncertain usage is not zero; real cross-session acceptance remains PER-1421. |
| Baseline/candidate run comparison | `insights.html` / `runs.html` | **Merged, operationally unqualified** | `observed-run-comparison-panel.tsx` requires completed, compatible observed runs from **different pinned source commits**. Comparison is descriptive, not an automatic release authorization. |
| Reported step-level trace graph and case matrix | `runs.html` | **Partial** | Display only actual provider/harness-reported spans, receipts and coverage; no fabricated tool calls or per-step costs. |
| Improvement recommendations, reviewer dispositions | `workbench.html` / `insights.html` | **Classic operational / Partial** | Existing recommendation/review APIs, permission and approval gates. No unattended auto-approval inferred from prototype controls. |
| Releases, policy, connectors and audit | `insights.html` / `settings.html` / `integrations.html` | **Partial** | Role/flag-dependent existing screens. Governance code merged in #102, **but active main protection and release promotion were not established at the snapshot**. |
| Integration providers, AI connections and skill router | `integrations.html` | **Classic operational / Partial** | Existing Settings, source control and `skill-router.tsx`. Actual features and costs depend on the authorized provider, not the appearance of a connector in UI. |
| Field report submission and triage | `reports.html` | **Partial / Planned triage** | Feedback/reporter storage and APIs exist; no verified complete operator triage UI. |
| Access management and SCIM sync | `access.html` / `settings.html` | **Partial / Planned SCIM** | Auth0 sign-in and workspace membership/role controls exist; SCIM synchronization remains planned. |
| Auto-Improve scheduling, recursive optimization, evaluation drift | `settings.html` / `workbench.html` / `evaluations.html` | **Planned** | No self-approval or background loop implied; reuse existing reviewed proposals until server contracts exist. |
| Discovery opportunities from observed work | `discovery.html` | **Planned** | Never present browser-generated observations as tenant telemetry. |
| Workflow Studio graph, versioned spec, validation and test | `workflows.html` | **Planned / separate roadmap** | Static `workflow-engine.js` is demonstration code. SAV-21/PER-1047 targets Git-backed WorkflowSpecification; Savant is **not** a production agent scheduler. |

## Production invariants and release dependencies

1. `apps/web`, its authenticated BFF and PostgreSQL/Git stores remain authoritative. Never embed or import `assets/savant.js`, `workflow-engine.js`, client storage, sample credentials or simulated results into production pages.
2. A CI-qualified PR or Vercel READY preview does not prove production availability. `SAVANT_UI_V2_ENABLED` and the workspace allowlist remain server-controlled and **off by default** until the scoped cutover.
3. Never show absent data as an observed zero. Explain `Not available`, `Planned`, `Unsupported by provider` or `Simulated` with provenance. Releases, approvals and costs must come from server evidence.
4. Source merges must preserve tenant-selected authorization, deep-link IDs, protected review/optimistic concurrency, safe Markdown, auditable mutations and the ability to use classic routes when v2 is off.
5. For the authorized **solo-owner, no-customer production-first pilot**, complete PER-1592's actual production Neon recovery and separately authorized schema activation, preserve distinct recoverable Test Bench/BYO AI encryption keys, then execute PER-1421 with **two synthetic tenant contexts**, real provider receipts, and rollback evidence. PER-1556/PER-1589 full isolated staging/KMS rehearsal is deferred to pre-customer hardening. The owner-operated GitHub ruleset remains desirable but is not a second-person approval requirement; do not claim live protection until applied.
6. A production React browser acceptance suite must test authenticated sessions, cross-tenant denial, 403/409/503, responsive + keyboard accessibility and repeatable multi-page journeys, including a deliberately read-only owner-authorized production pilot where applicable. **Prototype screenshot checks alone do not qualify it.**

**Scope tracking:** [PER-1576](https://linear.app/lattix/issue/PER-1576), [UX-00](https://linear.app/lattix/issue/PER-1577), [UX-01](https://linear.app/lattix/issue/PER-1579), [PR #66](https://github.com/LATTIX-IO/savant/pull/66), [PR #73](https://github.com/LATTIX-IO/savant/pull/73).
