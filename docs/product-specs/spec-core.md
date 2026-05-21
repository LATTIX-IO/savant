Below is the rewritten platform spec with the updated product name, stack, and monorepo structure.

# Savant Platform Spec

## Product Name

**Savant**

## GitHub Repo Name

**`savant`**

## One-Line Product Definition

Savant is a secure enterprise platform for turning expert knowledge into governed, reusable skills that can be versioned, tested, scored, approved, and distributed across AI tools and developer environments.

## Core Thesis

A skill is not just prompt text. It is a reusable unit of organizational intelligence.

Savant exists to help companies:

* codify expertise
* standardize high-value workflows
* test and compare skill quality
* control access to skills
* distribute approved skills across tools
* improve skills recursively over time with measurable evidence

The goal is to replace today’s scattered, local, YOLO-style skill usage with a secure and governed enterprise system.

---

# 1. Product Goals

## Primary goals

1. Centralize all skills in a secure enterprise registry
2. Support structured Tier 1, Tier 2, and Tier 3 skills
3. Add versioning, release control, and auditability
4. Provide A/B testing and quantified improvement scoring
5. Support recursive improvement loops
6. Enforce access control through SSO, IdP sync, and RBAC
7. Push approved skills to downstream tools and runtimes
8. Make rollback and release safety first-class

## Non-goals for v1

1. Not a foundation model hosting platform
2. Not a general workflow automation platform
3. Not a replacement for customer Git providers or source repos
4. Not a full IDE for prompt authoring
5. Not a general purpose document management system

---

# 2. Core Platform Capabilities

## A. Central skill registry

A single source of truth for all enterprise skills.

Each skill should support:

* unique ID
* tier and category
* metadata
* content files or repo-backed file trees
* references/assets
* dependencies
* evaluation datasets
* rubrics
* baselines
* source repository location
* branch/tag/commit reference
* access policy
* release status
* downstream distribution settings

## B. Versioning and release management

Every skill is a versioned artifact.

Support:

* semantic versioning
* draft/staging/production channels
* release approvals
* rollback to prior versions
* change summaries
* environment promotion history

## C. Quantification and recursive improvement

Every skill should be testable and measurable.

Support:

* A/B output comparisons
* eval datasets
* rubric-driven scoring
* baseline storage
* regression detection
* score trend tracking
* post-release performance monitoring

## D. Access control

Every skill must be permissioned.

Support:

* SSO login
* IdP-backed group sync
* RBAC at org/team/skill/environment level
* visibility and usage restrictions
* admin-defined access policies
* audit logs for access and changes

## E. Distribution and sync

Approved skills should be distributable to downstream tools.

Support:

* native push/pull where available
* managed sync agents for local/dev tools
* signed skill bundles
* staged rollouts
* rollback and pinning

---

# 3. User Types

## Platform admins

Manage org settings, auth, RBAC, connectors, release policies, and audit systems.

## Skill owners

Create, update, maintain, and propose skill releases.

## Evaluators/reviewers

Run evals, compare versions, review score deltas, and approve or reject changes.

## End users

Consume approved skills in their downstream tools.

## Security/compliance stakeholders

Audit who accessed which skills, what changed, and how distribution occurred.

---

# 4. Skill Lifecycle

1. Skill is created or imported
2. Skill starts in `draft`
3. Eval runner executes baseline and candidate comparisons
4. Reviewer inspects A/B deltas and scorecards
5. Skill is approved or revised
6. Skill is promoted to `staging`
7. Validation occurs
8. Skill is promoted to `production`
9. Distribution layer syncs to allowed tools
10. Usage, edits, and regressions feed back into the next revision

---

# 5. A/B Testing And Recursive Improvement Model

## Core principle

Savant should treat skills like production software.

A new skill version should not be accepted because it “feels better.” It should be accepted because it produces better outputs against a known evaluation set.

## A/B flow

For any skill change:

1. Run old version and new version against the same dataset
2. Score both outputs with a rubric
3. Generate a comparison report
4. Flag regressions
5. Require approval before baseline replacement

## Quantification layer

Track:

* task success rate
* rubric score
* first-pass acceptance
* human edit distance
* policy/safety compliance
* latency
* compute cost
* skill-specific quality measures

## Recursive loop

1. Observe real usage and edits
2. Capture failures and weak spots
3. Convert them into new eval cases
4. Update the skill
5. Run A/B tests
6. Promote only if better
7. Replace baseline
8. Repeat

This is how Savant turns skill management into a compounding system instead of an ad hoc one.

---

# 6. Security Model

## Authentication

Support:

* SAML SSO
* OIDC login
* SCIM provisioning later
* initial IdP targets:

  * Okta
  * Microsoft Entra ID
  * Google Workspace

## Authorization

RBAC must support:

* org-level roles
* team/group roles
* skill-level permissions
* environment-level permissions
* connector-level permissions

Permission examples:

* view
* use
* create
* edit
* review
* approve
* release
* administer
* manage-permissions
* manage-connectors

## Policy behavior

Admins should be able to enforce:

* who can see a skill
* who can use a skill
* who can edit a skill
* who can approve a skill
* which environments or downstream tools can receive a skill

## Security requirements

* encryption at rest
* TLS in transit
* signed skill bundles
* secret management for connector credentials
* immutable audit events
* role-restricted access to sensitive skills
* future support for customer-managed keys

---

# 7. Technical Stack

## Frontend

* **Next.js**
* **TypeScript**
* App Router
* Server Components where helpful
* Admin console + end-user catalog UI

## Backend/API

* **Next.js** for control-plane APIs where practical
* **A runtime selected after the Rust vs Python on Vercel assessment** for:

  * eval runners
  * bundle packaging
  * background jobs
  * connector sync orchestration
  * scoring pipelines

## Database

* **PostgreSQL**
* SQL migrations
* structured schema for:

  * orgs
  * users
  * groups
  * skills
  * versions
  * permissions
  * eval runs
  * scorecards
  * releases
  * audit logs
  * connectors

## Queue / background jobs

* Redis-backed or cloud queue
* worker runtime selected after the Vercel runtime assessment

## Storage

* provider-agnostic external Git environments for tenant-authored skill content and repository-backed source artifacts
* object storage for:

  * skill bundles
  * references/assets
  * eval artifacts
  * exported reports

## Authentication layer

* enterprise auth provider or direct integration
* support Vercel-friendly auth patterns first
* expand later for Azure deployment

---

# 8. Deployment Targets

## Initial target

**Vercel-first**

Use Vercel for:

* frontend
* Next.js control-plane APIs
* basic authenticated application hosting

Use external managed services for:

* PostgreSQL
* Redis/queue
* object storage
* runtime-selected worker deployment

## Later target

**Azure-hosted enterprise deployment**

Future deployment options:

* Azure Web App / App Service
* Azure Container Apps
* Azure Database for PostgreSQL
* Azure Blob Storage
* Azure Key Vault
* Entra ID integration

---

# 9. Monorepo Architecture

Savant should be built as a monorepo from the start.

## Monorepo goals

* one repo for FE, BE, DB, and shared contracts
* clean boundaries between layers
* shared types and schemas where useful
* consistent CI/CD
* easier local development
* easier release coordination

## Recommended monorepo structure

```text
savant/
  README.md
  LICENSE
  .gitignore
  package.json
  pnpm-workspace.yaml
  turbo.json

  apps/
    web/
      README.md
      package.json
      next.config.ts
      tsconfig.json
      src/
        app/
        components/
        lib/
        hooks/
        styles/

    api/
      README.md
      package.json
      tsconfig.json
      src/
        routes/
        services/
        auth/
        permissions/
        releases/
        skills/
        audit/

    worker/
      README.md
      src/
        jobs/
        evals/
        scoring/
        bundles/
        connectors/
        telemetry/

  packages/
    ui/
      package.json
      src/

    types/
      package.json
      src/

    config/
      package.json
      src/

    schemas/
      package.json
      src/
        skill/
        eval/
        scorecard/
        release/
        permissions/

    sdk/
      package.json
      src/

  db/
    README.md
    migrations/
    seeds/
    schema/
    queries/

  skills/
    README.md
    tier1/
    tier2/
    tier3/
    registry/
    templates/

  docs/
    architecture/
    product/
    security/
    api/
    operations/

  infra/
    vercel/
    docker/
    azure/
    scripts/

  .github/
    workflows/
```

---

# 10. Layer Responsibilities

## `apps/web`

Primary product UI:

* admin console
* skill catalog
* version history
* score dashboards
* access management UI
* release workflows
* audit exploration

## `apps/api`

Control-plane API layer in Next.js/TypeScript:

* auth/session handling
* skill CRUD
* metadata management
* release orchestration
* permission checks
* search and filtering
* API for downstream clients

If desired, this can begin inside `apps/web` and later split cleanly.

## `apps/worker`

Dedicated worker/runtime layer selected after the Rust vs Python Vercel assessment:

* eval execution
* A/B comparison
* rubric scoring
* bundle generation
* connector sync jobs
* scheduled telemetry processing
* background release tasks

## `packages/ui`

Shared design system and UI components.

## `packages/types`

Shared TypeScript types for API contracts and UI consumption.

## `packages/schemas`

Shared machine-readable schemas for:

* skills
* metadata
* evals
* scorecards
* releases
* permission policies

## `db/`

Database schema, migrations, seeds, and query utilities.

## `skills/`

Reference skill templates, local fixtures, and validation contracts.

This should support:

* tiered reference storage
* import/export
* validation
* local development of templates and fixture repos

---

# 11. Skill Storage Model

Savant should support two modes, but optimize for **external Git-backed tenant storage first**.

## Mode A: Tenant-connected external Git environment

Tenant-authored skills should live in a provider-agnostic external Git environment.

Support:

* connect an existing repository that already contains skills
* provision a new repository from a Savant template
* validate repository structure and manifests
* track repository identity, provider type, and default branch
* resolve approved skill versions to branch/tag/commit references
* ingest without assuming GitHub specifically

## Mode B: Internal reference and template assets

This monorepo's `skills/` directory should hold reference templates, local fixtures, and bootstrap layouts rather than being the primary store for tenant-authored production content.

Savant can ingest or provision external repositories while still applying:

* permissions
* evals
* approval workflows
* release management
* distribution

For v1, optimize for external Git-backed tenant storage first.

---

# 12. Data Model Overview

Core entities:

* Organization
* User
* Group
* RoleAssignment
* GitProviderConnection
* Skill
* SkillRepository
* SkillVersion
* SkillDependency
* EvalDataset
* EvalRun
* Scorecard
* Release
* ReleaseApproval
* Connector
* DistributionTarget
* AuditEvent
* AccessPolicy

Key relationships:

* a Skill has one repository source and many SkillVersions
* a SkillVersion resolves to a repository reference or imported snapshot
* a SkillVersion has many EvalRuns
* a Release promotes one SkillVersion to an environment
* permissions can attach at org, group, skill, and release scope
* connectors distribute only approved versions

---

# 13. Product Surfaces

## Admin console

* org configuration
* SSO/IdP setup
* group mapping
* connector setup
* policy editor
* audit logs
* release control

## Skill catalog

* browse/search skills
* see tier/category/owner
* see current production version
* see access status
* see score trend
* request access

## Eval dashboard

* candidate vs baseline
* pass/fail summary
* rubric breakdown
* regression flags
* reviewer comments

## Release dashboard

* draft/staging/production status
* approvals
* rollout progress
* rollback controls

---

# 14. Distribution Model

Savant must support three sync/distribution modes.

## 1. Native integrations

Where tools support direct remote distribution.

## 2. Managed sync agent

For local/developer environments like VS Code, Codex, CLI tools.

This agent should:

* authenticate to Savant
* pull allowed skills
* cache locally
* auto-refresh approved versions
* support pinning and rollback

## 3. Signed export bundles

For restricted environments or manual enterprise workflows.

---

# 15. CI/CD And Validation

## Required checks

* schema validation
* skill metadata validation
* git repository layout validation
* permission policy validation
* eval config validation
* migration checks
* release artifact generation tests
* API contract checks

## Release discipline

A production skill release should require:

* valid metadata
* successful eval run
* no unapproved critical regressions
* approval from required reviewers
* successful bundle build

---

# 16. MVP Scope

Build these first:

1. monorepo skeleton
2. Next.js app for admin console + catalog
3. PostgreSQL schema and migrations
4. auth and RBAC
5. skill registry and version model
6. runtime-selected eval worker
7. baseline vs candidate A/B comparison
8. release workflow
9. signed bundle generation
10. initial sync agent for local tools
11. audit logs

---

# 17. Success Metrics

Track:

* number of centrally managed skills
* percent of users on approved skills
* eval coverage across production skills
* average skill score improvement over time
* reduction in local skill drift
* release turnaround time
* rollback frequency
* permission violations prevented
* edit distance reduction after skill improvements

---

# 18. Acceptance Criteria

The Savant platform spec is satisfied when the system can:

1. store versioned skills centrally
2. organize skills by tier and category
3. enforce SSO-backed RBAC access
4. run A/B evals on skill revisions
5. quantify improvements and regressions
6. gate releases through approvals
7. distribute approved skills to downstream tools
8. roll back versions safely
9. provide a full audit trail
10. run as a clean monorepo across frontend, backend, worker, and database layers

---

# 19. Naming Summary

## Product

**Savant**

## Repo

**`savant`**

## Positioning line

**Savant is the enterprise platform for codifying expertise as governed, measurable, reusable skills.**

If you want, I can next turn this into either:

1. a full PRD with user stories and acceptance criteria, or
2. a developer-agent bootstrap spec for creating the monorepo scaffold in code.
