# Savant MVP Spec

## Document purpose

This document defines the **first production-usable MVP** of Savant.

The goal of this MVP is not to ship every long-term platform capability. The goal is to reach a state where real users can:

- onboard as a tenant
- connect an existing Git repository or create a new one
- bootstrap the repository with the correct Savant skill structure
- create skills through the platform
- run evaluations for those skills in-platform
- bring their own AI keys and use their own model ecosystem
- compare baseline vs candidate behavior side by side
- score skills and receive grounded recommendations for improving them
- track skills, releases, and evals through stable UUIDs

This MVP should be **production-ready for first real users**, not just a demo.

---

## 1. MVP product outcome

By the end of the MVP, Savant should operate as a secure multi-tenant platform where a tenant can use Git as the canonical source of skill content while using Savant as the operational control plane for onboarding, indexing, evaluation, scoring, release tracking, and auditability.

The platform should be ready for real usage by early tenants with:

- authenticated tenant access
- tenant isolation
- secrets handling for Git and AI credentials
- auditable operations
- observable backend behavior
- durable identifiers for key platform objects
- a repeatable repository bootstrap flow

---

## 2. MVP goals

### Primary goals

1. Allow a new tenant to onboard and establish a Savant workspace.
2. Allow a tenant to connect an existing external Git repository.
3. Allow a tenant to provision a new Git repository from a Savant bootstrap template.
4. Bootstrap the repository using a structure inspired by `D:/lattix/lattix-skills/`.
5. Allow users to create new skills from the Savant UI.
6. Store authored skill content in Git, not in Savant’s database.
7. Allow tenants to configure **bring-your-own-AI** credentials for evaluation runs.
8. Run skills against evaluation datasets inside Savant.
9. Provide side-by-side baseline vs candidate evaluation views.
10. Score skill quality and generate recommendations for improving the skill.
11. Track skills, releases, and evals with stable UUIDs.
12. Reach a level of operational readiness suitable for real user onboarding.

### Success statement

The MVP is successful when a tenant can go from **zero** to **a bootstrapped Git-backed skill repo, a created skill, and a completed in-platform eval with recommendations** without manual engineering intervention.

---

## 3. Scope

### In scope

- tenant creation and initial admin setup
- tenant-scoped authentication and authorization
- external Git repository connection
- new repository provisioning from a Savant template
- repository validation and indexing
- repository bootstrap based on the `lattix-skills` model
- in-platform skill creation
- skill metadata management
- skill evaluation in-platform
- BYO AI key management for eval execution
- baseline vs candidate comparison
- rubric-driven scoring
- AI-generated recommendations for improving a skill
- minimal release tracking and promotion records
- audit logging for tenant/repo/skill/eval/release activity
- UUID-based identity for skills, releases, and evals

### Out of scope for this MVP

- full downstream sync agents for all IDEs and runtimes
- continuous evaluation and always-on production monitoring
- automatic AI-driven edits committed back to Git without human review
- marketplace/discovery beyond the tenant’s own workspace
- billing and usage-based invoicing
- full multi-provider parity for Git and model providers on day one
- advanced multi-stage rollout orchestration beyond minimal release tracking
- large-scale long-running batch eval infrastructure for very large workloads

### Recommended rollout posture

The MVP should be built with **provider-neutral contracts**, but it is acceptable if direct provisioning ships **GitHub-first** so long as the domain model, repository contract, and APIs do not become GitHub-only.

Similarly, BYO AI should be modeled provider-neutrally even if the first supported providers are limited.

---

## 4. Primary users

### Tenant admin

Responsible for:

- establishing the tenant
- connecting Git and AI providers
- managing tenant settings
- managing users and permissions
- approving releases if required

### Skill owner

Responsible for:

- creating skills
- maintaining skill content
- reviewing eval output
- improving candidate versions
- initiating release actions

### Evaluator / reviewer

Responsible for:

- running evals
- inspecting scorecards
- reviewing baseline vs candidate output
- validating regressions or improvements
- approving or rejecting release readiness

---

## 5. MVP user journeys

## 5.1 Tenant onboarding

A user should be able to:

1. create a new tenant/workspace
2. define tenant name and slug
3. become the initial tenant admin
4. configure basic workspace defaults
5. invite additional users later
6. connect at least one Git provider
7. connect at least one BYO AI provider before running evals

### Required outcome

At the end of onboarding, the tenant has:

- a `tenant_uuid`
- an admin user
- at least one configured Git path for skills
- optional but recommended AI provider credentials for eval use

---

## 5.2 Connect an existing repository

A tenant admin should be able to connect a repository that already exists in their Git environment.

### Required behavior

Savant must:

- validate repository access
- identify provider type
- capture repository identity and default branch
- inspect the repo tree
- determine whether the repo already matches the Savant contract
- report validation results clearly
- index skills and registry data if compatible
- offer bootstrap/repair guidance if the structure is incomplete

### Output

A connected repository becomes a tenant-managed Savant repository record with:

- `repository_uuid`
- provider type
- external repository locator
- default branch
- sync/index status
- last indexed commit SHA

---

## 5.3 Create a new repository and bootstrap it

A tenant admin should also be able to create a new repository from Savant.

### Required behavior

Savant must:

- create a new repo in the tenant’s Git environment when supported
- otherwise produce an exportable starter template for manual creation
- initialize the repository with the Savant repo structure
- create the initial registry files
- commit the bootstrap content
- register the new repo as the tenant’s canonical skill source

### Bootstrap source

The bootstrap structure should be based on the conventions in:

- `D:/lattix/lattix-skills/`

It does not need to mirror that repository perfectly, but it must borrow its important ideas:

- registry-first design
- tiered skill organization
- per-skill package directories
- dedicated eval assets
- deterministic validation rules

---

## 5.4 Create a skill in-platform

A skill owner should be able to create a new skill from the Savant UI without manually hand-authoring the entire folder structure.

### Required behavior

Savant must:

- collect minimum skill metadata in the UI
- generate a stable `skill_uuid`
- scaffold the correct skill package path
- write required files into Git
- update the registry index
- commit the new skill package to the repository
- index the new skill back into Savant

### Minimum create-skill inputs

- display name
- tier
- owner
- domain/category
- summary
- initial status
- repository target
- package path
- optional dependencies
- optional starter dataset/rubric template

### Minimum generated package contents

Each skill package should include at least:

- `SKILL.md`
- `metadata.yaml`
- `agents/`
- `eval/`

---

## 5.5 Run an evaluation in-platform

A skill owner or evaluator should be able to run an evaluation in Savant.

### Required behavior

Savant must allow the user to choose:

- the skill to evaluate
- the baseline version/reference
- the candidate version/reference
- the dataset
- the rubric
- the AI provider/model used to execute the skill
- optionally a separate AI provider/model used to judge/score results

When the eval is launched, Savant must:

- generate an `eval_run_uuid`
- record the exact skill version/ref/commit used
- record the exact dataset and rubric used
- record the AI provider/model configuration used
- execute both baseline and candidate against the same evaluation inputs
- store the resulting outputs and scored summary
- surface the results in the UI

---

## 5.6 Review results side by side

The eval experience must include a side-by-side comparison view.

### Required side-by-side experience

The user must be able to see:

- baseline output
- candidate output
- per-case scoring
- rubric breakdown
- overall score delta
- regressions
- improvements
- execution metadata
- linked commit/reference information

### Required scoring outputs

Each eval should produce:

- case-level result
- rubric-dimension scores
- overall score
- pass/fail or pass-with-regressions summary
- detected regressions
- detected improvements
- recommendation summary

---

## 5.7 Receive recommendations for improving the skill

After scoring, Savant should recommend concrete improvements.

### Required behavior

Recommendations must be:

- grounded in eval evidence
- tied to rubric failures or weak spots
- specific enough to act on
- clearly separated from the current skill content
- advisory, not automatically applied

### Recommendation examples

Recommendations may target:

- `SKILL.md`
- `metadata.yaml`
- eval dataset coverage
- rubric criteria wording
- examples and constraints
- dependency choices
- output structure
- safety/guardrail gaps

### MVP rule

In the MVP, recommendations are **human-review guidance**. Savant should not automatically rewrite and commit skill changes without explicit future scope.

---

## 5.8 Create a minimal release record

The MVP must include minimal release tracking because users need a durable record of which version is approved for use.

### Required behavior

A release must:

- generate a `release_uuid`
- reference a specific skill and skill version/ref/commit
- record who initiated it
- record when it happened
- track release status
- support rollback/reference to a prior approved version

### MVP interpretation

This does **not** require the full long-term distribution system. It does require a durable release record for production usage inside Savant.

---

## 6. Repository contract for the MVP

The tenant repository contract should be inspired by `D:/lattix/lattix-skills/`.

## 6.1 Recommended top-level structure

```text
<tenant-skill-repo>/
  docs/
  registry/
    skills.yaml
    dependencies.yaml
    owners.yaml
    routing-policies.yaml
  sources/
    legacy/
  tier1/
    standards/
      <skill-package>/
  tier2/
    methodology/
      <domain>/
        <skill-package>/
  tier3/
    personal/
      <owner>/
        <skill-package>/
    workflow/
      <category>/
        <skill-package>/
  evals/
    baselines/
    datasets/
    fixtures/
    rubrics/
    runs/
  scripts/
  templates/
```

## 6.2 Required skill package structure

```text
<skill-package>/
  SKILL.md
  metadata.yaml
  agents/
    <provider>.yaml
  eval/
    dataset.yaml
    rubric.yaml
    baseline.json
```

### Minimum metadata expectations

Each metadata.yaml should include at least:

- `skill_uuid`
- `skill_id`
- `display_name`
- `tier`
- `owner`
- `version`
- `status`
- `summary`
- `depends_on`
- `eval_set_version`
- `rubric_version`

### MVP rule

If an imported skill does not yet have a `skill_uuid`, Savant should assign one during normalization/bootstrap and persist it back into the repo metadata.

---

## 7. Source-of-truth boundary

## 7.1 Canonical in Git

Git is the source of truth for:

- skill package contents
- registry files
- metadata manifests
- authored eval datasets
- authored rubrics
- baselines
- finalized retained comparison artifacts that are safe to keep in Git
- references and templates

## 7.2 Canonical in Savant-managed services

Savant/PostgreSQL is the source of truth for:

- tenants
- users
- memberships
- role bindings
- Git provider connections
- repository connection records
- sync state
- audit events
- release records
- eval orchestration state
- scored summaries and recommendations
- UI-facing read models
- workspace settings

## 7.3 Canonical in secret storage

Secret storage is the source of truth for:

- Git provider credentials
- webhook secrets
- BYO AI API keys
- signing keys
- token material

### Rule

Raw secrets must never be stored in:

- Git
- plaintext database fields
- logs
- metrics
- traces
- exported scorecards

---

## 8. UUID identity model

Skills, releases, and evals must be tied to UUIDs.

## 8.1 UUID requirements

### Required entities

| Entity | UUID field | Canonical location | Notes |
| --- | --- | --- | --- |
| Tenant | `tenant_uuid` | DB | Stable workspace identity |
| Repository | `repository_uuid` | DB | Stable Savant repo identity |
| Skill | `skill_uuid` | Git metadata + DB index | Must survive path/ref changes |
| Skill version | `skill_version_uuid` | DB/index | Optional for initial UX, but recommended |
| Eval run | `eval_run_uuid` | DB + eval artifact metadata | One UUID per eval execution |
| Release | `release_uuid` | DB + release metadata | One UUID per promotion/release event |
| AI connection | `ai_connection_uuid` | DB/secret reference | Tenant-scoped BYO AI connection |

## 8.2 MVP identity rules

1. `skill_uuid` must be generated once and then remain stable.
2. `skill_uuid` must be stored in metadata.yaml and mirrored into Savant indexes.
3. `eval_run_uuid` must be generated for every eval run.
4. `release_uuid` must be generated for every release record.
5. If eval artifacts are retained in Git, they should include the `eval_run_uuid`.
6. If release manifests or export bundles are generated, they should include the `release_uuid`.

## 8.3 UUID implementation note

For the first MVP, standard PostgreSQL/application-generated UUIDs are acceptable. The system does not need a custom ID scheme.

---

## 9. BYO AI model integration

The MVP must support tenants bringing their own AI credentials for evaluation.

## 9.1 Purpose

Tenants should be able to evaluate skills using models and providers that are part of their own ecosystem instead of forcing Savant-hosted model access.

## 9.2 Required capability

A tenant must be able to:

- create one or more AI provider connections
- store API credentials securely
- choose which provider/model to use for eval execution
- optionally choose a separate provider/model for judging/scoring
- rotate or revoke credentials
- see which provider/model was used for a completed eval

## 9.3 Recommended initial providers

The design should be provider-neutral.

Recommended initial providers for the MVP are:

- OpenAI
- Anthropic
- Azure OpenAI

## 9.4 Storage and security rules

- API keys must be stored in a secret manager or encrypted secret store.
- The database may store only references and metadata, not raw secrets.
- Keys must be tenant-scoped.
- Keys must never be written to Git.
- Keys must never appear in logs, traces, or exported reports.

---

## 10. Functional requirements

## FR-1 Tenant onboarding

Savant must allow a new tenant to:

- create a tenant/workspace
- create an initial admin account
- establish workspace defaults
- invite additional users later
- maintain tenant isolation from other tenants

## FR-2 Git repository onboarding

Savant must allow a tenant to:

- connect an existing repository
- create a new repository from a Savant template where supported
- validate repository access and structure
- persist repository metadata and sync status

## FR-3 Repository bootstrap

Savant must be able to:

- initialize the required directory structure
- initialize required registry files
- scaffold example or starter templates
- write bootstrap content back to the repository
- re-run validation after bootstrap

## FR-4 Skill creation

Savant must allow a user to:

- create a new skill from the UI
- assign a stable `skill_uuid`
- scaffold required files in Git
- update the repository registry
- capture the resulting commit/ref in Savant

## FR-5 Skill indexing

Savant must be able to:

- discover skill packages from the repository
- parse metadata and registry files
- index skill summaries into the control plane
- surface searchable/filterable skill views in the UI

## FR-6 BYO AI configuration

Savant must allow a tenant admin to:

- add and remove AI provider credentials
- choose default providers/models
- scope provider access to the tenant
- audit when AI credentials are used for eval operations

## FR-7 Eval execution

Savant must allow a user to:

- launch an eval run
- compare baseline and candidate versions
- use the tenant’s BYO AI connection
- generate a durable `eval_run_uuid`
- capture execution metadata, outputs, and scores

## FR-8 Eval review UX

Savant must present:

- side-by-side outputs
- per-case results
- rubric breakdown
- total score
- regressions and improvements
- recommendations for changes
- links to the underlying skill/version/ref

## FR-9 Recommendations

Savant must generate recommendations that:

- are grounded in observed eval output
- map to specific skill or eval assets
- explain why the change is recommended
- remain advisory in the MVP

## FR-10 Minimal release tracking

Savant must allow a user to:

- create a release record for a specific skill version
- assign a `release_uuid`
- mark a version as the current approved/active version
- keep release history
- reference a prior version for rollback

## FR-11 Auditability

Savant must audit at least the following actions:

- tenant created
- repository connected
- repository bootstrapped
- skill created
- skill indexed
- eval started
- eval completed
- release created
- release marked active
- AI connection added/rotated/revoked

## FR-12 Permissions

Savant must enforce tenant-aware permissions for:

- repository connection/provisioning
- skill creation
- eval execution
- release creation
- release approval if enabled
- AI credential management

---

## 11. Production-ready minimum requirements

To count as production-ready for first users, the MVP must include:

### Security

- authenticated access
- tenant isolation
- encrypted secrets handling
- least-privilege Git and AI connections
- no secret leakage in logs or reports

### Reliability

- idempotent repo bootstrap behavior
- retry handling for transient provider/API failures
- clear error states for failed sync/eval operations
- durable persistence of control-plane records

### Observability

- structured logs
- stable error codes
- request and operation identifiers
- audit events for sensitive workflows
- enough metrics/tracing to debug repo and eval failures

### Operations

- documented tenant onboarding flow
- backup/restore posture for PostgreSQL
- clear support/debug path for repository validation failures
- clear support/debug path for failed eval runs

### UX

- clear onboarding guidance
- clear validation messages for bad repository shape
- eval results understandable by non-engineers
- recommendations actionable by a skill owner

---

## 12. Non-goals and guardrails

The MVP must **not** rely on:

- Savant being the primary authoring store for skill content
- auto-applying AI recommendations to Git without human review
- direct browser access to privileged provider operations
- provider-specific assumptions leaking into the domain model
- storing raw BYO AI keys in Git or plaintext DB fields

The MVP should also avoid scope creep into:

- full CI/CD replacement
- full prompt IDE functionality
- multi-cloud deployment parity
- automated downstream agent distribution parity
- continuous optimization loops running without user control

---

## 13. Acceptance criteria

This MVP spec is satisfied when Savant can:

1. create a new tenant and initial admin user
2. connect an existing external Git repo or create a new repo from Savant
3. bootstrap that repo with a valid Savant skill structure inspired by lattix-skills
4. validate the repository contract successfully
5. create a new skill from the platform and commit it into Git
6. assign and persist a stable `skill_uuid`
7. configure BYO AI credentials for a tenant securely
8. run an eval using the tenant’s configured AI provider/model
9. assign a stable `eval_run_uuid`
10. present side-by-side baseline vs candidate results in-platform
11. score the skill using a rubric and surface regressions/improvements
12. generate actionable recommendations for improving the skill
13. create a release record tied to a stable `release_uuid`
14. keep audit history for tenant, repo, skill, eval, and release actions
15. operate with enough security, observability, and reliability for real user onboarding

---

## 14. Recommended next artifacts after this spec

The next documents that should follow this MVP spec are:

1. API contract spec for:
   - tenant onboarding
   - repo connect/provision/bootstrap
   - skill creation
   - eval launch/results
   - release creation/history

2. Database schema spec for:
   - tenant records
   - repository connections
   - AI provider connections
   - eval runs
   - release records
   - audit events
   - Git-derived read models

3. Repository bootstrap template spec defining:
   - exact starter files
   - registry initialization rules
   - required metadata fields
   - UUID insertion rules
