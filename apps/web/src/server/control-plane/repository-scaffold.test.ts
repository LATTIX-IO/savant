import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { getRepositoryProviderReadiness } from "@savant/types";
import { tenantSkillRepoContract } from "@savant/schemas/tenant-skill-repo-contract";

import {
  generateTenantSkillRepoBootstrapTemplate,
  validateTenantSkillRepoContract,
} from "./repository-scaffold.ts";

const templateRoot = fileURLToPath(
  new URL("../../../../../skills/templates/tenant-skill-repo", import.meta.url),
);

function collectRelativeFilePaths(currentPath: string, rootPath = currentPath): string[] {
  const entries = readdirSync(currentPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectRelativeFilePaths(absolutePath, rootPath));
      continue;
    }

    files.push(path.relative(rootPath, absolutePath).replace(/\\/g, "/"));
  }

  return files.sort();
}

test("validateTenantSkillRepoContract keeps connect validation pending without a repo snapshot", () => {
  const result = validateTenantSkillRepoContract({
    defaultBranch: "main",
    displayName: "Finance Skills",
    path: "connect",
    provider: "github",
    repoUrl: "github.com/acme/finance-skills",
    syncMode: "poll",
  });

  assert.equal(result.ready, false);
  assert.equal(result.validationSource, "awaiting-provider-preview");
  assert.deepEqual(result.providerReadiness, getRepositoryProviderReadiness("github"));
  assert.equal(result.summary.observedPathCount, 0);
  assert.deepEqual(result.missingTopLevelDirectories, []);
  assert.deepEqual(result.missingRegistryFiles, []);
  assert.equal(result.checks.find((check) => check.key === "repository-snapshot")?.status, "pending");
  assert.equal(result.checks.find((check) => check.key === "top-level-directories")?.status, "pending");
  assert.equal(result.checks.find((check) => check.key === "registry-files")?.status, "pending");
  assert.match(result.nextSteps.join(" "), /fetch the repository tree/i);
});

test("validateTenantSkillRepoContract warns when provider capabilities imply manual provisioning", () => {
  const result = validateTenantSkillRepoContract({
    defaultBranch: "main",
    displayName: "Finance Skills",
    path: "provision",
    provider: "selfhosted",
    repoUrl: "https://git.example.com/acme/finance-skills",
    syncMode: "manual",
  });

  assert.equal(result.ready, false);
  assert.deepEqual(result.providerReadiness, getRepositoryProviderReadiness("selfhosted"));
  assert.equal(result.checks.find((check) => check.key === "provider-support")?.status, "fail");
  assert.match(
    result.checks.find((check) => check.key === "provider-support")?.meta ?? "",
    /github is the only provider-backed provisioning/i,
  );
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
      "sources/legacy/README.md",
      "tier1/standards/compliance-review/SKILL.md",
      "tier1/standards/compliance-review/metadata.yaml",
      "tier2/methodology/legal/contract-review-assistant/SKILL.md",
      "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
      "tier2/methodology/legal/contract-review-assistant/eval/dataset.yaml",
      "tier3/workflow/research/triage-helper/SKILL.md",
      "tier3/workflow/research/triage-helper/metadata.yaml",
      "evals/datasets/contracts.yaml",
      "evals/rubrics/default.yaml",
      "scripts/README.md",
      "templates/README.md",
    ],
    path: "connect",
    provider: "github",
    repoUrl: "github.com/acme/finance-skills",
    syncMode: "poll",
  });

  assert.equal(result.ready, true);
  assert.equal(result.validationSource, "snapshot-override");
  assert.deepEqual(result.providerReadiness, getRepositoryProviderReadiness("github"));
  assert.equal(result.summary.missingTopLevelDirectoryCount, 0);
  assert.equal(result.summary.missingRegistryFileCount, 0);
  assert.equal(result.summary.discoveredSkillPackageCount, 3);
  assert.equal(result.checks.find((check) => check.key === "repository-snapshot")?.status, "ok");
  assert.equal(result.checks.find((check) => check.key === "top-level-directories")?.status, "ok");
  assert.equal(result.checks.find((check) => check.key === "registry-files")?.status, "ok");
  assert.ok(result.nextSteps.includes("Repository contract is satisfied; proceed to indexing or ingest."));
});

test("validateTenantSkillRepoContract preserves an explicit live-preview validation source", () => {
  const result = validateTenantSkillRepoContract(
    {
      defaultBranch: "main",
      displayName: "Finance Skills",
      observedPaths: [
        "docs/README.md",
        "registry/skills.yaml",
        "registry/dependencies.yaml",
        "registry/owners.yaml",
        "registry/routing-policies.yaml",
        "evals/datasets/contracts.yaml",
        "evals/rubrics/default.yaml",
        "templates/README.md",
      ],
      path: "connect",
      provider: "gitlab",
      repoUrl: "gitlab.com/acme/finance-skills",
      syncMode: "poll",
    },
    { validationSource: "provider-live-preview" },
  );

  assert.equal(result.validationSource, "provider-live-preview");
  assert.deepEqual(result.providerReadiness, getRepositoryProviderReadiness("gitlab"));
});

test("tenant skill repo contract keeps retained eval fixtures in Git-owned storage", () => {
  const repoEvalSection = tenantSkillRepoContract.storageBoundary.gitOwned.find(
    (section) => section.key === "repo-evals",
  );

  assert.ok(repoEvalSection);
  assert.ok(repoEvalSection.paths.includes("evals/fixtures/**"));
});

test("checked-in tenant repository template stays aligned with the bootstrap scaffold", () => {
  const bootstrap = generateTenantSkillRepoBootstrapTemplate({
    defaultBranch: "main",
    displayName: "Finance Skills",
    provider: "github",
    repoUrl: "github.com/acme/finance-skills",
    syncMode: "poll",
  });
  const templateFiles = collectRelativeFilePaths(templateRoot);
  const templateReadme = readFileSync(path.join(templateRoot, "README.md"), "utf8");

  assert.deepEqual(
    templateFiles.filter((filePath) => filePath !== "README.md" && !filePath.endsWith("/.gitkeep")),
    bootstrap.files.map((file) => file.path).sort(),
  );

  assert.ok(templateFiles.includes("evals/baselines/.gitkeep"));
  assert.ok(templateFiles.includes("evals/datasets/.gitkeep"));
  assert.ok(templateFiles.includes("evals/fixtures/.gitkeep"));
  assert.ok(templateFiles.includes("evals/rubrics/.gitkeep"));
  assert.ok(templateFiles.includes("evals/runs/.gitkeep"));

  assert.ok(!templateFiles.includes("datasets/.gitkeep"));
  assert.ok(!templateFiles.includes("references/.gitkeep"));
  assert.ok(!templateFiles.includes("rubrics/.gitkeep"));
  assert.ok(!templateFiles.includes("skills/tier1/.gitkeep"));
  assert.ok(!templateFiles.includes("skills/tier2/.gitkeep"));
  assert.ok(!templateFiles.includes("skills/tier3/.gitkeep"));

  assert.match(templateReadme, /generateTenantSkillRepoBootstrapTemplate\(\)/);
  assert.match(templateReadme, /registry\//);
  assert.match(templateReadme, /tier1\//);
  assert.match(templateReadme, /evals\//);
  assert.doesNotMatch(templateReadme, /^\s{2}skills\/$/m);
  assert.doesNotMatch(templateReadme, /^\s{2}references\/$/m);
  assert.doesNotMatch(templateReadme, /^\s{2}rubrics\/$/m);
});