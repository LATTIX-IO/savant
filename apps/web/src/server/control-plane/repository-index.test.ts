import assert from "node:assert/strict";
import test from "node:test";

import {
  parseRepositoryIndexSnapshot,
  RepositoryIndexError,
} from "./repository-index.ts";

test("parseRepositoryIndexSnapshot indexes a complete skill package from metadata and registry files", () => {
  const result = parseRepositoryIndexSnapshot({
    defaultBranch: "main",
    commitSha: "abc123def456",
    observedPaths: [
      "registry/skills.yaml",
      "registry/dependencies.yaml",
      "registry/owners.yaml",
      "registry/routing-policies.yaml",
      "tier2/methodology/legal/contract-review-assistant/SKILL.md",
      "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
      "tier2/methodology/legal/contract-review-assistant/agents",
      "tier2/methodology/legal/contract-review-assistant/eval",
    ],
    files: {
      "registry/skills.yaml": [
        "version: 1",
        "skills:",
        '  - skill_id: "legal/contract-review-assistant"',
        '    display_name: "Contract Review Assistant"',
        '    package_path: "tier2/methodology/legal/contract-review-assistant"',
        "    tier: tier2",
        '    status: "draft"',
      ].join("\n") + "\n",
      "registry/dependencies.yaml": [
        "version: 1",
        "dependencies:",
        '  - skill_id: "legal/contract-review-assistant"',
        "    depends_on:",
        '      - "tier1.compliance-review"',
      ].join("\n") + "\n",
      "registry/owners.yaml": [
        "version: 1",
        "owners:",
        '  - owner: "legal-ops"',
        "    skills:",
        '      - "legal/contract-review-assistant"',
      ].join("\n") + "\n",
      "registry/routing-policies.yaml": [
        "version: 1",
        "policies:",
        '  - skill_id: "legal/contract-review-assistant"',
        '    default_channel: "draft"',
      ].join("\n") + "\n",
      "tier2/methodology/legal/contract-review-assistant/metadata.yaml": [
        'skill_id: "legal/contract-review-assistant"',
        'display_name: "Contract Review Assistant"',
        "tier: tier2",
        'owner: "legal-ops"',
        'version: "1.2.0"',
        'status: "draft"',
        'summary: "Review contract language and highlight risk."',
      ].join("\n") + "\n",
      "tier2/methodology/legal/contract-review-assistant/SKILL.md": "# Contract Review Assistant\n\nReview contracts.\n",
    },
  });

  assert.equal(result.skills.length, 1);
  assert.deepEqual(result.parsedRegistryFiles, [
    "registry/skills.yaml",
    "registry/owners.yaml",
    "registry/dependencies.yaml",
    "registry/routing-policies.yaml",
  ]);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.skills[0]?.skillId, "legal/contract-review-assistant");
  assert.equal(result.skills[0]?.displayName, "Contract Review Assistant");
  assert.equal(result.skills[0]?.dependencies.source, "registry");
  assert.deepEqual(result.skills[0]?.dependencies.dependencies, ["tier1.compliance-review"]);
  assert.equal(result.skills[0]?.versionRef, "1.2.0");
  assert.equal(result.skills[0]?.channel, "draft");
});

test("parseRepositoryIndexSnapshot warns and skips incomplete skill packages", () => {
  const result = parseRepositoryIndexSnapshot({
    defaultBranch: "main",
    commitSha: "abc123def456",
    observedPaths: [
      "registry/skills.yaml",
      "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
      "tier2/methodology/legal/contract-review-assistant/SKILL.md",
    ],
    files: {
      "registry/skills.yaml": "version: 1\nskills: []\n",
      "tier2/methodology/legal/contract-review-assistant/metadata.yaml": "skill_id: foo\n",
      "tier2/methodology/legal/contract-review-assistant/SKILL.md": "# Foo\n",
    },
  });

  assert.equal(result.skills.length, 0);
  assert.ok(result.warnings.some((warning) => /required skill package files are missing/i.test(warning)));
});

test("parseRepositoryIndexSnapshot fails closed when metadata yaml is invalid", () => {
  assert.throws(
    () => parseRepositoryIndexSnapshot({
      defaultBranch: "main",
      commitSha: "abc123def456",
      observedPaths: [
        "registry/skills.yaml",
        "tier2/methodology/legal/contract-review-assistant/metadata.yaml",
        "tier2/methodology/legal/contract-review-assistant/SKILL.md",
        "tier2/methodology/legal/contract-review-assistant/agents",
        "tier2/methodology/legal/contract-review-assistant/eval",
      ],
      files: {
        "registry/skills.yaml": "version: 1\nskills: []\n",
        "tier2/methodology/legal/contract-review-assistant/metadata.yaml": "skill_id: [unterminated\n",
        "tier2/methodology/legal/contract-review-assistant/SKILL.md": "# Contract Review Assistant\n",
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof RepositoryIndexError);
      assert.equal(error.code, "repository_index_invalid_yaml");
      return true;
    },
  );
});
