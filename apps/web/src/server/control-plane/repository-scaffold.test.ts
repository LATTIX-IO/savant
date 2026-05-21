import assert from "node:assert/strict";
import test from "node:test";

import { validateTenantSkillRepoContract } from "./repository-scaffold.ts";

test("validateTenantSkillRepoContract keeps connect validation pending without a repo snapshot", () => {
  const result = validateTenantSkillRepoContract({
    defaultBranch: "main",
    displayName: "Finance Skills",
    path: "connect",
    provider: "github",
    repoUrl: "github.com/acme/finance-skills",
    syncMode: "webhook",
  });

  assert.equal(result.ready, false);
  assert.equal(result.summary.observedPathCount, 0);
  assert.deepEqual(result.missingTopLevelDirectories, []);
  assert.deepEqual(result.missingRegistryFiles, []);
  assert.equal(result.checks.find((check) => check.key === "repository-snapshot")?.status, "pending");
  assert.equal(result.checks.find((check) => check.key === "top-level-directories")?.status, "pending");
  assert.equal(result.checks.find((check) => check.key === "registry-files")?.status, "pending");
  assert.match(result.nextSteps.join(" "), /fetch the repository tree/i);
});

test("validateTenantSkillRepoContract marks a complete connect snapshot as ready", () => {
  const result = validateTenantSkillRepoContract({
    defaultBranch: "main",
    displayName: "Finance Skills",
    observedPaths: [
      "docs/README.md",
      "registry/skills.yaml",
      "registry/dependencies.yaml",
      "registry/owners.yaml",
      "registry/routing-policies.yaml",
      "tier1/standards/compliance-review/SKILL.md",
      "tier1/standards/compliance-review/metadata.yaml",
      "tier2/methodology/legal/contract-review-assistant/SKILL.md",
      "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
      "tier2/methodology/legal/contract-review-assistant/eval/dataset.yaml",
      "tier3/workflow/research/triage-helper/SKILL.md",
      "tier3/workflow/research/triage-helper/metadata.yaml",
      "evals/datasets/contracts.yaml",
      "evals/rubrics/default.yaml",
      "templates/README.md",
    ],
    path: "connect",
    provider: "github",
    repoUrl: "github.com/acme/finance-skills",
    syncMode: "webhook",
  });

  assert.equal(result.ready, true);
  assert.equal(result.summary.missingTopLevelDirectoryCount, 0);
  assert.equal(result.summary.missingRegistryFileCount, 0);
  assert.equal(result.summary.discoveredSkillPackageCount, 3);
  assert.equal(result.checks.find((check) => check.key === "repository-snapshot")?.status, "ok");
  assert.equal(result.checks.find((check) => check.key === "top-level-directories")?.status, "ok");
  assert.equal(result.checks.find((check) => check.key === "registry-files")?.status, "ok");
  assert.ok(result.nextSteps.includes("Repository contract is satisfied; proceed to indexing or ingest."));
});