import assert from "node:assert/strict";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import { generateSkillScaffold } from "./skill-scaffold.ts";
import {
  mergeSkillScaffoldRegistryFiles,
  SkillScaffoldApplyError,
} from "./skill-scaffold-apply.ts";

test("mergeSkillScaffoldRegistryFiles appends the new skill and merges owner memberships", () => {
  const scaffold = generateSkillScaffold({
    category: "contracts",
    dependencies: ["shared/legal-style", "shared/risk-taxonomy"],
    displayName: "Contract Review Assistant",
    domain: "legal",
    owner: "platform-team",
    status: "draft",
    summary: "Review commercial contracts and flag material risk language.",
    tier: "tier2",
  });
  const merged = mergeSkillScaffoldRegistryFiles({
    snapshot: {
      observedPaths: [
        "README.md",
        "registry/skills.yaml",
        "registry/owners.yaml",
        "registry/dependencies.yaml",
        "registry/routing-policies.yaml",
        "tier1/standards/existing-skill/SKILL.md",
      ],
      files: {
        "registry/skills.yaml": `version: 1
skills:
  - skill_uuid: 11111111-1111-4111-8111-111111111111
    skill_id: governance/existing-skill
    display_name: Existing Skill
    package_path: tier1/standards/governance/existing-skill
    owner: platform-team
    tier: tier1
    status: active
`,
        "registry/owners.yaml": `version: 1
owners:
  - owner: platform-team
    skills:
      - governance/existing-skill
`,
        "registry/dependencies.yaml": `version: 1
dependencies:
  - skill_id: governance/existing-skill
    depends_on: []
`,
        "registry/routing-policies.yaml": `version: 1
policies:
  - skill_id: governance/existing-skill
    default_channel: review
    match:
      tier: tier1
`,
      },
    },
    scaffold,
  });

  assert.equal(merged.length, 4);

  const mergedSkills = parseYaml(
    merged.find((file) => file.path === "registry/skills.yaml")?.content ?? "",
  ) as { skills: Array<Record<string, unknown>> };
  const mergedOwners = parseYaml(
    merged.find((file) => file.path === "registry/owners.yaml")?.content ?? "",
  ) as { owners: Array<Record<string, unknown>> };
  const mergedDependencies = parseYaml(
    merged.find((file) => file.path === "registry/dependencies.yaml")?.content ?? "",
  ) as { dependencies: Array<Record<string, unknown>> };

  assert.equal(mergedSkills.skills.length, 2);
  assert.ok(
    mergedSkills.skills.some((entry) => entry.skill_id === "legal/contract-review-assistant"),
  );
  assert.deepEqual(mergedOwners.owners, [
    {
      owner: "platform-team",
      skills: ["governance/existing-skill", "legal/contract-review-assistant"],
    },
  ]);
  assert.ok(
    mergedDependencies.dependencies.some(
      (entry) =>
        entry.skill_id === "legal/contract-review-assistant"
        && Array.isArray(entry.depends_on)
        && entry.depends_on.includes("shared/legal-style"),
    ),
  );
});

test("mergeSkillScaffoldRegistryFiles rejects skill id conflicts already present in the registry", () => {
  const scaffold = generateSkillScaffold({
    displayName: "Executive Brief Prep",
    owner: "Sasha Green",
    personSlug: "sasha-green",
    summary: "Prepare a concise executive-ready brief with open questions and next steps.",
    tier: "tier3",
    tier3Kind: "personal",
  });

  assert.throws(
    () => mergeSkillScaffoldRegistryFiles({
      snapshot: {
        observedPaths: [
          "registry/skills.yaml",
          "registry/owners.yaml",
          "registry/dependencies.yaml",
          "registry/routing-policies.yaml",
        ],
        files: {
          "registry/skills.yaml": `version: 1
skills:
  - skill_uuid: 22222222-2222-4222-8222-222222222222
    skill_id: personal/sasha-green/executive-brief-prep
    display_name: Existing Brief Prep
    package_path: tier3/personal/sasha-green/executive-brief-prep
    owner: Sasha Green
    tier: tier3
    status: active
`,
          "registry/owners.yaml": "version: 1\nowners: []\n",
          "registry/dependencies.yaml": "version: 1\ndependencies: []\n",
          "registry/routing-policies.yaml": "version: 1\npolicies: []\n",
        },
      },
      scaffold,
    }),
    (error: unknown) => {
      assert.ok(error instanceof SkillScaffoldApplyError);
      assert.equal(error.code, "skill_scaffold_skill_id_conflict");
      assert.equal(error.status, 409);
      return true;
    },
  );
});