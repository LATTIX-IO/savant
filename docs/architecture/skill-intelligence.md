# Skill Intelligence (Savant + Microsoft SkillOpt)

- Status: Implemented for initial production (MVP phases 1–5)
- Date: 2026-09-29

Skill Intelligence turns Savant from a governed skill registry into a
closed-loop improvement platform:

```text
USE → OBSERVE → MEASURE → LEARN → PROPOSE → VALIDATE → HUMAN APPROVAL → RELEASE → DISTRIBUTE → OBSERVE AGAIN
```

Microsoft SkillOpt is the optimization engine inside this loop. It is not the
system of record, and product terminology never depends on it. It appears only
as technical provenance ("Optimization engine: Microsoft SkillOpt").

## The product boundary

```text
SkillOpt MAY:      analyze · reflect · suggest · patch · generate candidates · run evaluations
SkillOpt MAY NOT:  approve · publish · change permissions · modify production · distribute · alter governance
```

This boundary is enforced structurally, not by convention:

| Guarantee | Where it is enforced |
|---|---|
| The optimizer never has DB, Git, or release credentials | The worker holds only `SAVANT_WORKER_TOKEN`. The sandbox env is allowlist-only, and `FORBIDDEN_ENV` blocks DB URLs, tokens, and keys (`services/skillopt-adapter/.../sandbox/workspace.py`) |
| Locked regions can't be read or changed | The adapter masks `SAVANT:LOCK` regions before the engine runs, and any placeholder tampering rejects the candidate. The control plane re-verifies byte-identity (`locked-sections.ts`, `regression-gate.ts`) |
| Edits stay bounded | Budget checks run in the adapter and again in the control plane (`skill-diff.ts#verifyChangeBudget`). Tier ceilings clamp aggressiveness |
| The worker's verdict is never trusted | The control plane re-derives edits from base → candidate and recomputes the gate and bootstrap CI from raw paired case results (`service.ts#submitOptimizationResult`) |
| Only humans approve | `recommendation-workflow.ts#applyReviewDecision` is the only transition to `approved`. It requires the validated content hash, a passing gate, and N distinct authorized reviewers |
| Nothing reaches production directly | Approval commits a new version to Git and opens a `draft → staging` release request. Production promotion stays with the existing release policy |
| No autonomous deployment mode | `AutoOptimizationMode` is `off \| observe \| recommend \| continuous-evaluation`. Settings normalization rejects any other value |

## Architecture

```text
 Instrumented runtimes (Savant SDK, Codex CLI, sync agent, APIs …)
        │  POST /api/skill-runs   (Bearer svt_… tenant ingest token)
        ▼
 apps/web  (control plane / BFF — ADR-0001)
   ├─ validate → capture-mode downgrade → redact → pseudonymize → encrypt artifacts
   ├─ health · cohorts · coverage · failure clusters · triggers · eligibility
   ├─ optimization_jobs queue  ── claim/lease ──►  services/skill-intelligence (worker)
   │                                                 ├─ 3rd redaction pass
   │                                                 ├─ curation: TRAIN / VALIDATION / REGRESSION / HOLDOUT
   │                                                 ├─ services/skillopt-adapter
   │                                                 │    └─ sandbox → pinned SkillOpt (TRAIN+VALIDATION only)
   │                                                 └─ baseline vs candidate on VALIDATION, REGRESSION, HOLDOUT
   │  ◄── POST result (raw paired scores + provenance) ──┘
   ├─ re-derive edits · re-check locks & budget · recompute gate & bootstrap CI
   ├─ improvement_recommendations → human review (approve / modify / reject / more tests)
   └─ approved → Git commit (new version) → release_requests (draft → staging) → existing release rail
```

Per ADR-0001, all control-plane logic lives in `apps/web/src/server/skill-intelligence`
and `apps/web/src/lib/skill-intelligence`. Python is used where SkillOpt lives,
in `services/`. The worker talks to the control plane only through the
internal API, so it can be deployed and scaled separately and holds no
production database credentials.

### Code map

| Concern | Location |
|---|---|
| Domain types & worker contract | `packages/types/src/skill-intelligence.ts` |
| JSON Schemas + shared fixture | `packages/schemas/src/skill-intelligence.ts`, `packages/schemas/fixtures/` |
| Schema | `db/schema/0005_skill_intelligence.sql` |
| Redaction, weak labels, health, clusters, triggers, policy, locks, diff/budget, gate, workflow | `apps/web/src/lib/skill-intelligence/` |
| Service, stores (Postgres + in-memory), runtime wiring, RBAC | `apps/web/src/server/skill-intelligence/` |
| API routes | `apps/web/src/app/api/{skill-runs,skills/[id]/intelligence,skills/[id]/improvements,improvements,intelligence,internal}` |
| UI | Skill page tabs **Runs / Insights / Improvements** (`screens/skill-intelligence-tabs.tsx`); org dashboard `/intelligence` (`screens/intelligence.tsx`) |
| Adapter (pin, translator, sandbox, engines, guardrails) | `services/skillopt-adapter/` |
| Worker (ingestion client, privacy, curation, objective, validation) | `services/skill-intelligence/` |

## Telemetry

- **Observability levels.** `full`, `io`, or `outcome`. The stored level is the
  lower of what the runtime sends and the tenant capture mode (`metrics-only`,
  `inputs-outputs`, or `full-trajectories`). Dropped fields are reported back
  to the sender. Coverage is shown per runtime (FULL / PARTIAL / OUTCOME ONLY).
- **Privacy.**
  - Secrets are always redacted.
  - Configured PII classes are redacted before persistence.
  - Actors are pseudonymized unless raw identity retention is enabled.
  - Cohorts are technical only (runtime, model, version, task archetype, connector, BU, input structure).
- **Storage.**
  - Large payloads go in `skill_run_artifacts`, AES-256-GCM encrypted with
    `TELEMETRY_ENCRYPTION_KEY` and AAD bound to tenant/run/kind.
  - `storage_backend` allows a later move to object storage.
  - Without a key, runs are stored as outcome-only; plaintext is never stored.
- **Retention.** Every run and artifact has `expires_at`. The sweep purges expired telemetry.
- **Sensitive skills.** `optimizationDisabledSkills` keeps outcome metrics only
  and blocks optimization.
- **Weak labels.** Raw passive/explicit events are stored. `derived_score` is
  versioned (`weighting_version`) so the weighting can evolve.
- **Audit.** Governance events are written to `audit_events`:
  - `optimization.triggered`, `optimization.started`, `optimization.completed`, `optimization.failed`
  - `recommendation.created`, `recommendation.reevaluated`, `recommendation.reviewed`
  - `candidate.approved`, `candidate.rejected`, `candidate.release_pending`
  - `skill.version.released`
  - settings and token changes

  High-volume `skill.run.*` / `skill.feedback.recorded` events live in their
  own immutable tables instead of flooding the audit log.

## Evidence discipline

- **Minimum evidence.** Defaults: 30 runs, 10 distinct tasks, 5 failures, and
  10 held-out cases. Tier 1 doubles all four.
- **Triggers.** Performance degradation, failure cluster, high edit rate, new
  environment, scheduled (weekly for high-use skills, monthly otherwise), and manual.
- **Curation.**
  - Tasks are hash-partitioned by fingerprint, so no task crosses partitions and runs are reproducible.
  - HOLDOUT is never sent to the optimizer.
  - REGRESSION holds strong positives, protecting behavior that already works.
  - TRAIN is stratified-sampled.
- **Gate.** The control plane recomputes all of these:
  - primary objective improves
  - every guardrail dimension is non-decreasing
  - the regression suite passes
  - locks are byte-identical
  - the change budget holds
  - the bootstrap interval excludes zero with enough samples
  - the shadow holdout doesn't regress
  - Tier 1 dependents' suites pass
  - no runtime regresses more than 3 points
  - the required human approvals are present

  A higher total score cannot hide a safety regression.
- **Prioritization.** The improvement queue sorts by `impact × confidence × usage`.

## Tier policy

| Tier | Approvals | Max aggressiveness | Evidence | Notes |
|---|---|---|---|---|
| 1 Standards | 2 | conservative | ×2 | Dependent-skill regression suites required before approval |
| 2 Methodology | 2 (owner + SME) | balanced | ×1 | Primary SkillOpt target |
| 3 Personal | 1 | exploratory | ×1 | Recommendations target only that skill; never a shared T2 skill |

Reviewer RBAC covers the workspace Owner, `platform-admins`, `skill-reviewers`,
and the skill's declared owner. Approvals must come from distinct reviewers.
Staging a release requires Owner or platform-admin, because it writes to Git
through the existing write-access checks.

## SkillOpt dependency strategy

- **Not forked.** SkillOpt is invoked through its CLI inside the sandbox. The
  adapter never imports SkillOpt's internal object model.
- **Pinned.** `services/skillopt-adapter/skillopt.lock.toml` pins the version
  (0.2.0), an optional source commit, the command templates, and the sandbox
  policy. Its hash is recorded as `configHash` on every candidate.
- **MIT license.** Notice is in `services/skillopt-adapter/THIRD_PARTY_NOTICES.md`.
- **`MockEngine`.** Deterministic, with no provider calls, mirroring SkillOpt's
  own `mock` backend. Tests and local development use it.

> **Before enabling `--engine skillopt` in production**, verify the `[commands]`
> templates against the pinned SkillOpt release. Run
> `python -m savant_skillopt_adapter doctor`. The templates encode an assumed
> CLI shape (`skillopt train` / `skillopt eval`), which has not been validated
> against 0.2.0 in this repository.

## Running locally

```bash
# One shared worker token for both processes
export SAVANT_WORKER_TOKEN=$(openssl rand -hex 32)

# Control plane (no DATABASE_URL → in-memory store with seeded demo telemetry)
pnpm dev

# Worker, one job, deterministic mock engine
cd services/skill-intelligence
uv run python -m savant_skill_intelligence --engine mock worker --control-plane http://localhost:3000 --once

# Tests
pnpm test            # TypeScript (includes the Skill Intelligence suites)
pnpm test:python     # adapter + worker
```

In development, the Improvements tab shows a "Dev reviewer alias" field, so one
person can exercise multi-reviewer approval. The server ignores it outside
development fallback.

## Deferred (spec §31, §51, §52)

These are deliberately not built yet:
- runtime-specific skill variants
- embedding-based clustering (clusters are deterministic today)
- SME reviewer weighting beyond 2× feedback weight
- eval-dataset improvement recommendations
- missing-skill, duplicate-capability, and consolidation discovery
- Tier 3 → Tier 2 promotion discovery
- executing dependent skills' regression suites

For that last item, the gate already requires dependent suite results for
Tier 1 skills that have dependents, and blocks approval when they're missing.
The worker currently reports none, so such Tier 1 candidates stay blocked
until suite execution lands.
