# Production UI modernization — canonical migration contract

**Reference:** `docs/product/ux-prototype/`, UX-00 / PR #66. Versioned design and interaction target; integrating this reference alone does not activate runtime behavior.
**Runtime:** `apps/web` (Next.js 16 / React 19 / TypeScript), server-authoritative existing APIs.
**Implementation candidate:** consolidated UX-P1..P4 PR #73 (`feature/ux-p4-git-workbench`), initially feature-flag **off**.
**Verified main baseline (October 20):** `3404fc7948bc24e5b436a45f57e3c31daea5ca1e` (after PR #106's owner-authorized production-MVP admission source merge; real database recovery/migration still outstanding). Recheck current main when integrating.

## Non-negotiable architecture

- Reimplement visual patterns in React/TypeScript, never serve static prototype HTML/JS or transfer its browser-local state into production.
- Git owns reproducible tenant-authored artifacts and immutable pinned source commits; PostgreSQL owns tenant-scoped indexes, case definitions, run receipts, approvals and metadata. Authorization and operational results are server controlled.
- Savant provides AI **quality engineering** for bring-your-own model, inference router or harness. Workflow visualization/validation does **not** promise a production runtime, proxy, hosted model or scheduling service.
- Maintain existing canonical `/o/[workspaceSlug]` paths and IDs, server-side membership checks, classic fallbacks and optional governance actions. Do not cross-load object IDs between tenants when switching workspace.
- The UI exposure controls `SAVANT_UI_V2_ENABLED` and `SAVANT_UI_V2_WORKSPACES` default off and do not grant privileges. Their change requires a deployment/config refresh.

## Navigation contract

| Intent | Current canonical tenant route / owned source | V2 behavior at this snapshot |
| --- | --- | --- |
| Overview | `/dashboard` · server overview | Draft #73 — live server metrics and provenance |
| Library and marketplace | `/skills`, `/repositories`, `/catalog` | Draft #73 — live skill/repository lists, classic marketplace/repository management deep links |
| Workbench | `/skills/[id]` | Draft #73 — single `SKILL.md` source and review-only Git proposal; no fabricated file tree/execution |
| Evaluations and Test Bench | `/evaluations`, `/evaluations/[uuid]` | Classic operational screen; persisted suite/runner source merged via #101, production database/key activation and v2 migration still required |
| Runs / case evidence | Existing evaluation and skill detail routes | No fake standalone `/runs`; real receipts/telemetry and provenance only |
| Insights and releases | `/intelligence`, `/releases` | Classic routes retained pending v2 migration |
| Integration, router and governance | `/router`, `/connectors`, `/policies`, `/audit` | Real RBAC/feature-gated routes; no simulated source/AI connection |
| Administration | `/settings` | Preserve tenant admin, billing and approvals behind established permissions |
| Discovery, reports triage, Workflow Studio | No generally authorized dedicated v2 routes | Planned/unavailable until corresponding source-backed flows ship |

## Ordered increments — single bounded PR deliverable per step

| Increment | Objective | Definition of done |
| --- | --- | --- |
| **UX-00** (PER-1577) | Qualify PR #66 static reference, screenshot and capability contract | Versioned reference, post-#106 production-first capability inventory, browser assertions, reviewed screenshots, no runtime change |
| **UX-01** (PER-1579) | Bring existing PR #73 source forward onto actual main | Exact-current-head build/API/security checks and rollback; server flag OFF after source merge. Genuine production authenticated browser testing belongs to the next single-owner canary increment; old UX-P1..P4 code preserved |
| **UX-02** (PER-1580) | Canonical shell/deep-link and navigation parity | No unreachable existing features or tenant-unsafe link state, keyboard/mobile, role-gated menus |
| **UX-03** (PER-1581) | Persisted Evaluations/Test Bench UI | Authorized create/save/run/cancel/reopen with pinned provider/source and budget; no invented result |
| **UX-04** (PER-1582) | Runs/evidence drilldown | Persisted per-case observed receipt, terminal/error, coverage, cost uncertainty, tenant isolation |
| **UX-05** (PER-1583) | Insights, baseline/candidate comparison and releases | Compatible paired pinned runs only; human-reviewed optimization/release claims |
| **UX-06** (PER-1584) | Integrations, onboarding and Settings | Existing provider/role/billing/governance actions retained and accurate |
| **UX-07** (PER-1585) | Real authenticated cross-screen QA | Owner and two synthetic organization contexts, foreign-tenant denial, provider failures, WCAG 2.2 AA, responsive regression, live evidence |
| **UX-08** (PER-1586) | Controlled canary/default cutover | Observed owner allowlist canary, actual production rollback, negative tenant/UX tests before default-on; full staging/KMS rehearsal retained before customer onboarding |
| **UX-09/10** (PER-1587/1588) | Workflow Studio, discovery/reports and advanced optimization | **Not canonical-release blockers.** Source-backed only; split separate backend dependencies if required |

**Consolidation note:** old UX-P1/P2/P3/P4 PR histories are already present in the single implementation branch #73; do not independently merge superseded #67/#69/#71. PRs #62–#65 and their older stack references are no longer an accurate dependency plan; source functionality was integrated via PR #101. The live managed-key/database and customer acceptance gates are **still open**.

## Test-driven acceptance for each change

- RED: deterministic unit, permission and contract failure/negative fixtures; GREEN: reuse existing server-backed API and components; REFACTOR: existing app and DB/security regressions remain intact.
- Exact-current-head Node/TS tests, ESLint, TypeScript, Next build, no-secret scan, standalone high/critical dependency audit, tenant/PostgreSQL integration and Vercel preview.
- Authenticated browser at 390, 768, 1280 and 1440 pixels in **light and dark** with keyboard and screen-reader semantics, all real 403/409/429/503 cases, slow/network failure and member revocation. Keep separate reports for prototype/static and production React.
- Compare multi-page journeys: repository → skill → reviewed change proposal → saved suite → authorized observed run → per-case results → paired comparison → proposal/release review. Verify reload and workspace switching with actual server data. Record exact commit/preview/provenance, not screenshots alone.
- Security: untrusted Markdown, CSRF/origin, hostile path encodings, optimistic concurrency, provider entitlement, tenant denial before provider I/O, cost/budget uncertainty and credential redaction.

## Source integration versus release

1. Integrate/reference PR #66 and source PR #73 **only after current-head green checks**; the v2 flag stays off during initial source merge.
2. Do not enable schema-dependent Test Bench execution until PER-1592's actual production database recovery and manually authorized schema activation, distinct recoverable encryption keys, and PER-1421 real provider/cross-tenant acceptance. Full PER-1556 staging KMS rehearsal remains pre-customer hardening, not the owner pilot gate.
3. Validate zero production migration on Next/Vercel build and route fallback under `SAVANT_UI_V2_ENABLED=false`. Solo-owner GitHub ruleset source is present but live enforcement is not yet active; do not demand a second human reviewer for CI-qualified owner-authorized source integration or falsely claim protection.
4. Enable one known owner-operated synthetic workspace in production via the server allowlist after authenticated checks, measure failed navigation/HTTP errors/user paths and security denials, exercise kill-switch via configuration/redeploy, then change default only with owner authorization and verifiable rollback artifacts.

**Cutover means** the redesigned interface is the default route and supported operational path **after** all six primary journeys, auth/security/visual quality gates and rollback have passed. It does not require a fully executable Workflow Studio or prototype-only features.
