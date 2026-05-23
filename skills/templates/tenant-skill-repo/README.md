# Tenant skill repository template

This directory is the checked-in reference template for a tenant-owned external Git repository.

The on-disk files under this folder intentionally mirror the scaffold returned by `generateTenantSkillRepoBootstrapTemplate()` so the human-readable template and the API bootstrap preview stay aligned.

## Suggested layout

```text
tenant-skill-repo/
  docs/
    README.md
  registry/
    skills.yaml
    dependencies.yaml
    owners.yaml
    routing-policies.yaml
  sources/
    legacy/
      README.md
  tier1/
    standards/
      README.md
  tier2/
    methodology/
      README.md
  tier3/
    personal/
      README.md
    workflow/
      README.md
  evals/
    README.md
    baselines/
    datasets/
    fixtures/
    rubrics/
    runs/
  scripts/
    README.md
  templates/
    README.md
```

## Source-of-truth boundary

- Git owns registry files, tiered skill packages, retained repository-level eval assets, templates, docs, and migration traceability.
- Savant-managed services own organizations, memberships, provider connections, sync state, releases, audit trails, and other rebuildable control-plane state.
- Secrets, connector credentials, webhook secrets, signing keys, and transient logs do not belong in this repository.

## Notes

- `registry/` is the canonical index for skill discovery, ownership, dependencies, and routing.
- `tier1/`, `tier2/`, and `tier3/` provide deterministic package roots so Savant can validate repositories across providers.
- `evals/` is for intentionally retained baselines, datasets, fixtures, rubrics, and comparison artifacts that should travel with repository history.
- `sources/legacy/` is optional traceability for imported or migrated content.

This template is intentionally provider-agnostic and does not assume GitHub-specific features.
