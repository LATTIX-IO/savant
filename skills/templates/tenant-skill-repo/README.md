# Tenant skill repository template

This directory documents the recommended starter layout for a tenant-owned external Git repository.

Savant should use this structure when provisioning a new repository in a customer's Git environment, and it should validate incoming repositories against a compatible contract when ingesting an existing repo.

## Suggested layout

```text
tenant-skill-repo/
  skills/
    tier1/
    tier2/
    tier3/
  registry/
  datasets/
  rubrics/
  references/
```

## Notes

- `skills/` contains the authored skill files organized by tier
- `registry/` contains metadata indexes or manifests used for discovery and validation
- `datasets/` contains evaluation datasets that are safe to keep in Git
- `rubrics/` contains scoring and review guidance artifacts
- `references/` contains non-secret supporting material that belongs with the repo

This template is intentionally provider-agnostic and does not assume GitHub-specific features.
