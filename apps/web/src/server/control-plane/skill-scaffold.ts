import "server-only";

import { randomUUID } from "node:crypto";

import type {
  RepoScaffoldDirectory,
  RepoScaffoldFile,
  SkillScaffoldPayload,
  SkillScaffoldRequest,
} from "@savant/types";

function slugifySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "skill";
}

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function toYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function deriveSkillId(request: SkillScaffoldRequest, skillSlug: string): string {
  if (request.skillId) {
    return request.skillId.trim();
  }

  if (request.tier === "tier1") {
    return `tier1.${skillSlug}`;
  }

  if (request.tier === "tier2") {
    const domain = slugifySegment(request.domain ?? request.category ?? "general");
    return `${domain}/${skillSlug}`;
  }

  if (request.tier3Kind === "workflow") {
    const category = slugifySegment(request.category ?? request.domain ?? "general");
    return `workflow/${category}/${skillSlug}`;
  }

  const personSlug = slugifySegment(request.personSlug ?? request.owner);
  return `personal/${personSlug}/${skillSlug}`;
}

function derivePackagePath(request: SkillScaffoldRequest, skillSlug: string): string {
  if (request.packagePath) {
    return normalizePath(request.packagePath);
  }

  if (request.tier === "tier1") {
    return `tier1/standards/${skillSlug}`;
  }

  if (request.tier === "tier2") {
    const domain = slugifySegment(request.domain ?? request.category ?? "general");
    return `tier2/methodology/${domain}/${skillSlug}`;
  }

  if (request.tier3Kind === "workflow") {
    const category = slugifySegment(request.category ?? request.domain ?? "general");
    return `tier3/workflow/${category}/${skillSlug}`;
  }

  const personSlug = slugifySegment(request.personSlug ?? request.owner);
  return `tier3/personal/${personSlug}/${skillSlug}`;
}

function buildDirectories(packagePath: string): RepoScaffoldDirectory[] {
  return [
    { path: packagePath, purpose: "Root of the skill package." },
    { path: `${packagePath}/agents`, purpose: "Provider-specific overlays and execution metadata." },
    { path: `${packagePath}/eval`, purpose: "Skill-local datasets, rubric definitions, and baseline artifacts." },
  ];
}

function buildSkillMarkdown(request: SkillScaffoldRequest): string {
  return `# ${request.displayName}\n\n## Summary\n\n${request.summary}\n\n## Purpose\n\nDescribe what this skill should do, when it should be used, and what good output looks like.\n\n## Required inputs\n\n- task\n- context\n\n## Output expectations\n\n- response\n- key considerations\n- follow-up questions when context is incomplete\n\n## Constraints\n\n- stay within approved scope\n- explain assumptions when inputs are incomplete\n- follow referenced dependencies instead of duplicating them\n`;
}

function buildMetadataYaml(
  request: SkillScaffoldRequest,
  skillUuid: string,
  skillId: string,
  skillSlug: string,
): string {
  const dependencies = (request.dependencies ?? [])
    .map((entry) => `  - ${toYamlScalar(entry)}`)
    .join("\n");

  return [
    `skill_uuid: ${toYamlScalar(skillUuid)}`,
    `skill_id: ${toYamlScalar(skillId)}`,
    `display_name: ${toYamlScalar(request.displayName)}`,
    `tier: ${request.tier}`,
    `owner: ${toYamlScalar(request.owner)}`,
    `version: ${toYamlScalar(request.version ?? "0.1.0")}`,
    `status: ${toYamlScalar(request.status ?? "draft")}`,
    `summary: ${toYamlScalar(request.summary)}`,
    `domain: ${toYamlScalar(request.domain ?? "general")}`,
    `category: ${toYamlScalar(request.category ?? "general")}`,
    `slug: ${toYamlScalar(skillSlug)}`,
    "depends_on:",
    dependencies || "  []",
    `eval_set_version: ${toYamlScalar(request.version ?? "0.1.0")}`,
    `rubric_version: ${toYamlScalar(request.version ?? "0.1.0")}`,
  ].join("\n") + "\n";
}

function buildAgentOverlay(skillId: string): string {
  return [
    "version: 1",
    `skill_id: ${toYamlScalar(skillId)}`,
    `provider: ${toYamlScalar("openai")}`,
    `model: ${toYamlScalar("<MODEL_NAME>")}`,
    "temperature: 0.2",
    "notes:",
    "  - Replace placeholders with tenant-approved execution settings.",
  ].join("\n") + "\n";
}

function buildDatasetYaml(): string {
  return [
    "version: 1",
    "dataset_id: starter-dataset",
    "cases:",
    "  - case_id: sample-001",
    "    input:",
    "      task: <REPLACE_TASK>",
    "      context: <REPLACE_CONTEXT>",
    "    expected_outcomes:",
    "      - Clear and accurate response",
    "      - Explicit assumptions when context is incomplete",
  ].join("\n") + "\n";
}

function buildRubricYaml(): string {
  return [
    "version: 1",
    "dimensions:",
    "  - key: correctness",
    "    weight: 0.4",
    "    description: Output is accurate and grounded in the supplied context.",
    "  - key: completeness",
    "    weight: 0.3",
    "    description: Output addresses the task with the required structure and follow-up details.",
    "  - key: safety",
    "    weight: 0.3",
    "    description: Output respects policy, scope, and stated constraints.",
  ].join("\n") + "\n";
}

function buildBaselineJson(skillId: string): string {
  return JSON.stringify(
    {
      skill_id: skillId,
      version: "0.1.0",
      generated_at: "<REPLACE_WITH_TIMESTAMP>",
      overall_score: 0,
      notes: [
        "Replace this placeholder after the first baseline evaluation run completes.",
      ],
    },
    null,
    2,
  ) + "\n";
}

export function generateSkillScaffold(
  request: SkillScaffoldRequest,
): SkillScaffoldPayload {
  const skillSlug = slugifySegment(request.displayName);
  const packagePath = derivePackagePath(request, skillSlug);
  const skillId = deriveSkillId(request, skillSlug);
  const skillUuid = randomUUID();
  const directories = buildDirectories(packagePath);

  const files: RepoScaffoldFile[] = [
    {
      path: `${packagePath}/SKILL.md`,
      purpose: "Human-authored skill instructions and operating guidance.",
      content: buildSkillMarkdown(request),
    },
    {
      path: `${packagePath}/metadata.yaml`,
      purpose: "Structured skill metadata used by Savant for indexing and governance.",
      content: buildMetadataYaml(request, skillUuid, skillId, skillSlug),
    },
    {
      path: `${packagePath}/agents/openai.yaml`,
      purpose: "Starter provider overlay for execution settings.",
      content: buildAgentOverlay(skillId),
    },
    {
      path: `${packagePath}/eval/dataset.yaml`,
      purpose: "Starter evaluation dataset with one example case.",
      content: buildDatasetYaml(),
    },
    {
      path: `${packagePath}/eval/rubric.yaml`,
      purpose: "Starter rubric for baseline and candidate comparison.",
      content: buildRubricYaml(),
    },
    {
      path: `${packagePath}/eval/baseline.json`,
      purpose: "Placeholder baseline artifact to be replaced after the first real run.",
      content: buildBaselineJson(skillId),
    },
  ];

  return {
    skillUuid,
    skillId,
    packagePath,
    directories,
    files,
    notes: [
      "Commit the generated scaffold to the tenant-owned repository before indexing.",
      "Replace placeholder dataset, rubric, and baseline content with tenant-specific evaluation assets.",
      "Keep the generated skill_uuid stable across later edits and releases.",
    ],
  };
}