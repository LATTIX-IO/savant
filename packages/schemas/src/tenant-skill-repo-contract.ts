import type { TenantSkillRepoContract } from "@savant/types/tenant-skill-repo";

export const tenantSkillRepoContract: TenantSkillRepoContract = {
  version: 1,
  exampleRepository: "d:\\lattix\\lattix-skills",
  requiredTopLevelDirectories: ["registry", "tier1", "tier2", "tier3", "evals", "templates"],
  optionalTopLevelDirectories: ["docs", "scripts", "sources"],
  requiredRegistryFiles: [
    "registry/skills.yaml",
    "registry/dependencies.yaml",
    "registry/owners.yaml",
    "registry/routing-policies.yaml",
  ],
  skillDirectoryGlobs: [
    "tier1/standards/**",
    "tier2/methodology/**",
    "tier3/personal/**",
    "tier3/workflow/**",
  ],
  requiredSkillPackageFiles: ["SKILL.md", "metadata.yaml", "agents/", "eval/"],
  notes: [
    "Registry files are the canonical index for discovery, ownership, routing, and dependency resolution.",
    "Tier 1, Tier 2, and Tier 3 package paths should remain deterministic so repository scans can be provider-neutral.",
    "Authored evaluation datasets, rubrics, baselines, and finalized comparison artifacts may live in Git when they are intentionally retained.",
    "Transient worker logs, secret material, and queue telemetry must remain outside the repository.",
  ],
  storageBoundary: {
    gitOwned: [
      {
        key: "registry",
        description: "Canonical skill index, dependency map, owner metadata, and routing policies.",
        paths: [
          "registry/skills.yaml",
          "registry/dependencies.yaml",
          "registry/owners.yaml",
          "registry/routing-policies.yaml",
        ],
      },
      {
        key: "skill-packages",
        description: "Tenant-authored skill packages and their required metadata, agent overlays, and authored evaluation assets.",
        paths: ["tier1/**", "tier2/**", "tier3/**"],
      },
      {
        key: "repo-evals",
        description: "Repository-level authored evaluation assets and retained evidence that should travel with the repo history.",
        paths: ["evals/baselines/**", "evals/datasets/**", "evals/rubrics/**", "evals/runs/**"],
      },
      {
        key: "templates-and-traceability",
        description: "Provisioning templates, docs, and optional migration traceability assets.",
        paths: ["templates/**", "docs/**", "sources/legacy/**"],
      },
    ],
    databaseOwned: [
      {
        key: "workspace-governance",
        description: "Organizations, users, groups, memberships, role bindings, and workspace settings.",
        paths: ["organizations", "users", "groups", "role-bindings", "workspace-settings"],
      },
      {
        key: "repository-control-plane",
        description: "Provider connections, installed app references, repository registrations, webhook state, and sync health.",
        paths: ["git-provider-connections", "repositories", "repository-sync-state", "repository-webhooks"],
      },
      {
        key: "release-and-review-workflows",
        description: "Review requests, comments, release approvals, rollout targets, and audit events.",
        paths: ["review-requests", "review-comments", "release-requests", "release-approvals", "audit-events"],
      },
      {
        key: "derived-indexes",
        description: "Rebuildable indexes and summaries extracted from Git for fast UI queries and search.",
        paths: ["indexed-skills", "indexed-skill-versions", "indexed-eval-assets", "indexed-eval-results"],
      },
    ],
    forbiddenInGit: [
      "connector credentials",
      "API tokens",
      "webhook secrets",
      "signing keys",
      "transient worker logs",
      "queue telemetry",
      "private operational crash dumps",
    ],
  },
};