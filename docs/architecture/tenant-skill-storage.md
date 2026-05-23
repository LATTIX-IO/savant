# Tenant skill storage architecture

## Decision summary

Savant should treat a tenant-connected, **provider-agnostic external Git environment** as the canonical source of truth for **tenant-authored skill content**.

This means Savant must support two primary flows:

1. **Connect an existing repository** that already contains skills
2. **Provision a new repository** in the tenant's Git environment from a Savant template

The design should not assume GitHub specifically. The storage layer should be built around Git concepts and adapter interfaces that can support:

- GitHub
- GitLab
- Azure DevOps Repos
- Bitbucket
- self-hosted Git providers

## Why this is the preferred model

- keeps tenant-authored skill content in infrastructure the customer already trusts
- preserves native Git workflows such as branching, pull requests, and commit history
- avoids locking Savant to a single source-control provider
- makes ingesting existing skill investments possible without migration into a proprietary store
- supports provisioning a fresh repo when a tenant wants Savant-managed structure without Savant-owned storage

## Scope boundary

The Git environment should be the source of truth for **tenant-authored repository content**, such as:

- skill package files such as `SKILL.md`, `metadata.yaml`, `agents/`, and package-local `eval/`
- registry files used for discovery, ownership, dependencies, and routing
- retained repo-level baselines, datasets, fixtures, rubrics, and finalized comparison artifacts that are safe and appropriate to store as files
- supporting docs, templates, and packaged source traceability assets

Savant-managed services should remain the source of truth for **platform governance and operational state**, such as:

- organizations, users, groups, and memberships
- RBAC, access policies, and permission grants
- release approvals, environment promotion state, and rollout records
- audit events and access logs
- eval runs, scorecards, and derived metrics
- connector credentials, secrets, and token material

The practical rule is:

- **Git owns authored artifacts and reproducible evidence**
- **PostgreSQL owns control-plane state and rebuildable indexes**

If an item can be deterministically re-created by reading a repository at a known commit SHA, it should not be treated as canonical database state.

If we try to force all platform state into Git, governance and operational queries get awkward fast. So the safest interpretation is: **Git stores tenant-authored skill artifacts; Savant stores the control-plane state around them**.

## Supported tenant flows

### 1. Connect existing repository

Savant should be able to:

- register a repository locator and provider type
- validate repository access
- inspect repository shape and detect Savant-compatible content
- ingest manifests and build control-plane metadata without relocating the content source

### 2. Provision new repository

Savant should be able to:

- generate a starter layout from a template
- create the repository inside the tenant's Git environment when the provider supports it
- fall back to an exportable template bundle when direct creation is not available
- register the new repository as the tenant's canonical skill source

## Reference repository shape

Use `d:\lattix\lattix-skills` as the current reference implementation for tenant repository shape.

Savant should provision and validate repositories that follow this registry-first, tiered package structure:

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

Each skill package should contain at least:

- `SKILL.md`
- `metadata.yaml`
- `agents/`
- `eval/`

The exact repo can evolve, but Savant should validate against a machine-readable contract so ingest and sync remain deterministic across providers.

## Source-of-truth boundary

### Canonical in Git

- `registry/*.yaml`
- tiered skill packages under `tier1/`, `tier2/`, and `tier3/`
- skill package files such as `SKILL.md`, `metadata.yaml`, `agents/*`, and `eval/*`
- repo-level authored evaluation assets under `evals/`, including retained baselines, datasets, fixtures, rubrics, and runs
- references, templates, and legacy migration traceability files

### Canonical in Savant-managed services

- organizations, users, groups, memberships, and role bindings
- repository connection records, installation references, and sync state
- access policies and policy bindings
- review requests, reviewer comments, and release approvals
- rollout state, connector installations, audit events, and workspace settings
- secret references for tokens, webhook secrets, and signing keys

### Not for Git

- connector credentials and API tokens
- webhook secrets and signing keys
- transient job logs, queue telemetry, and worker crash dumps
- private operational metadata that is not intended to be customer-authored content

## Integration model

Savant should model Git storage through a provider-neutral adapter layer with capabilities such as:

- validate repository access
- read repository tree or archive contents
- create repositories when allowed
- create or update commits/branches/tags
- receive webhooks or poll for change events
- resolve commit SHAs for released skill versions

This keeps the application tied to stable capabilities instead of one provider's API quirks.

## Release implications

A released skill version should resolve to a specific Git reference, plus Savant-controlled release metadata:

- repository identity
- branch/tag/commit reference
- validated manifest snapshot
- promotion and approval state
- downstream distribution state

That gives Savant reproducibility without owning the tenant's authored content store.

## Security considerations

- use least-privilege repository credentials
- support app/install-based access where providers offer it
- never persist long-lived secrets in repo content
- audit all repository connects, syncs, provisions, and release fetches
- separate repository read access from repository write/provision permissions

When evaluation artifacts are committed back to Git, only finalized and intentionally retained artifacts should be written. Transient execution logs, sensitive payloads, and secret material must remain outside the repository.

## Open implementation questions

- Which provider integrations are required for the first release?
- Do we require webhook support in v1, or is polling acceptable for some providers?
- Which artifacts are too sensitive or too large for Git and should move to object storage?
- How should Savant behave when a tenant changes repository default branch or provider credentials?
