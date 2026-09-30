import type { AssessmentFinding, ChangeProposalFile, SkillScaffoldRequest } from "@savant/types";
import { isMap, isSeq, parseDocument, YAMLMap, YAMLSeq, type Document } from "yaml";

import {
  buildAgentOverlay,
  buildBaselineJson,
  buildDatasetYaml,
  buildRubricYaml,
  buildSkillMarkdown,
} from "../control-plane/skill-scaffold.ts";
import type { AssessedSkillRoot } from "./assess.ts";

/**
 * Turns fixable assessment findings into concrete file changes. Existing
 * registry and metadata files are edited through the YAML document model so
 * comments and ordering survive; new files reuse Savant's scaffold templates.
 */

export class FixGenerationError extends Error {
  readonly code = "FIX_UNAVAILABLE";
}

const DIRECTORY_PURPOSE: Record<string, string> = {
  registry: "Canonical registry files for skill discovery, ownership, routing policies, and dependencies.",
  tier1: "Tier 1 standards: organization-wide skills with the strictest review and release policy.",
  tier2: "Tier 2 methodology skills, grouped by domain.",
  tier3: "Tier 3 workflow and personal skills with lightweight review.",
  evals: "Shared evaluation datasets, rubrics, and baselines used across skills.",
  templates: "Templates used to scaffold new skill packages.",
};

type FileState = { path: string; original: string | null; content: string };

type RootInfo = AssessedSkillRoot & { skillId: string; displayName: string; owner: string | null };

function describeRoot(root: AssessedSkillRoot): RootInfo {
  const meta = root.metadata ?? {};
  const text = (key: string) => (typeof meta[key] === "string" && (meta[key] as string).trim() ? (meta[key] as string).trim() : null);
  return {
    ...root,
    skillId: text("skill_id") ?? root.inferredSkillId,
    displayName: text("display_name") ?? root.inferredDisplayName,
    owner: text("owner") ?? root.inferredOwner,
  };
}

function registryDocument(content: string | null, key: string): Document {
  const document = parseDocument(content ?? `version: 1\n${key}: []\n`);
  if (!isMap(document.contents)) {
    document.contents = document.createNode({ version: 1, [key]: [] }) as never;
  }
  const map = document.contents as unknown as YAMLMap;
  if (!isSeq(map.get(key, true))) {
    map.set(key, new YAMLSeq());
  }
  return document;
}

function sequence(document: Document, key: string): YAMLSeq {
  return (document.contents as unknown as YAMLMap).get(key, true) as unknown as YAMLSeq;
}

export function buildFixChanges(input: {
  findings: readonly AssessmentFinding[];
  roots: readonly AssessedSkillRoot[];
  files: Readonly<Record<string, string>>;
}): ChangeProposalFile[] {
  const states = new Map<string, FileState>();
  const roots = input.roots.map(describeRoot);
  const rootFor = (finding: AssessmentFinding): RootInfo | undefined =>
    roots.find((root) => root.skillId === finding.skillId || (finding.path !== null && finding.path.startsWith(`${root.root}/`)));

  const read = (path: string): FileState => {
    let state = states.get(path);
    if (!state) {
      const original = input.files[path] ?? null;
      state = { path, original, content: original ?? "" };
      states.set(path, state);
    }
    return state;
  };
  const create = (path: string, content: string) => {
    const state = read(path);
    if (state.original === null && state.content === "") {
      state.content = content;
    }
  };
  const editYaml = (path: string, key: string, mutate: (items: YAMLSeq, document: Document) => void) => {
    const state = read(path);
    const document = registryDocument(state.content || null, key);
    mutate(sequence(document, key), document);
    state.content = document.toString();
  };

  const registerSkill = (root: RootInfo) => {
    editYaml("registry/skills.yaml", "skills", (items, document) => {
      const exists = items.items.some((item) => isMap(item) && (item.get("package_path") === root.root || item.get("skill_id") === root.skillId));
      if (!exists) {
        items.add(document.createNode({
          skill_id: root.skillId,
          display_name: root.displayName,
          package_path: root.root,
          tier: root.tier,
          status: typeof root.metadata?.status === "string" ? root.metadata.status : "draft",
        }));
      }
    });
  };

  const addOwner = (root: RootInfo) => {
    if (!root.owner) {
      return;
    }
    editYaml("registry/owners.yaml", "owners", (items, document) => {
      const existing = items.items.find((item) => isMap(item) && item.get("owner") === root.owner) as YAMLMap | undefined;
      if (existing) {
        const skills = existing.get("skills", true);
        if (isSeq(skills)) {
          if (!skills.items.some((item) => (typeof item === "object" && item && "value" in item ? item.value : item) === root.skillId)) {
            skills.add(root.skillId);
          }
        } else {
          existing.set("skills", document.createNode([root.skillId]));
        }
      } else {
        items.add(document.createNode({ owner: root.owner, skills: [root.skillId] }));
      }
    });
  };

  for (const finding of input.findings) {
    if (!finding.fix) {
      continue;
    }

    switch (finding.fix.kind) {
      case "create_directory_readme": {
        const directory = (finding.path ?? "").replace(/\/+$/, "");
        create(`${directory}/README.md`, `# ${directory}\n\n${DIRECTORY_PURPOSE[directory] ?? "Part of the Savant skill repository layout."}\n`);
        break;
      }

      case "create_registry_file": {
        const path = finding.path ?? "";
        if (path === "registry/skills.yaml") {
          create(path, "version: 1\nskills: []\n");
          roots.filter((root) => root.missing.length === 0 || root.metadata).forEach(registerSkill);
        } else if (path === "registry/owners.yaml") {
          create(path, "version: 1\nowners: []\n");
          roots.forEach(addOwner);
        } else if (path === "registry/dependencies.yaml") {
          create(path, "version: 1\ndependencies: []\n");
        } else if (path === "registry/routing-policies.yaml") {
          create(path, "version: 1\npolicies: []\n");
          editYaml(path, "policies", (items, document) => {
            for (const root of roots) {
              items.add(document.createNode({ skill_id: root.skillId, default_channel: "draft", match: { tier: root.tier } }));
            }
          });
        } else {
          throw new FixGenerationError(`No generator exists for ${path}.`);
        }
        break;
      }

      case "register_skill": {
        const root = rootFor(finding);
        if (root) registerSkill(root);
        break;
      }

      case "add_owner_entry": {
        const root = rootFor(finding);
        if (root) addOwner(root);
        break;
      }

      case "scaffold_skill_file": {
        const root = rootFor(finding);
        if (!root) break;
        const missing = (finding.path ?? "").slice(root.root.length + 1);
        if (missing === "SKILL.md") {
          create(`${root.root}/SKILL.md`, buildSkillMarkdown({ displayName: root.displayName, summary: `TODO: summarize what ${root.displayName} does.` } as SkillScaffoldRequest));
        } else if (missing === "metadata.yaml") {
          create(`${root.root}/metadata.yaml`, [
            `skill_id: ${JSON.stringify(root.skillId)}`,
            `display_name: ${JSON.stringify(root.displayName)}`,
            `tier: ${root.tier}`,
            `owner: ${JSON.stringify(root.owner ?? "unassigned")}`,
            'version: "0.1.0"',
            'status: "draft"',
          ].join("\n") + "\n");
        } else if (missing === "agents/") {
          create(`${root.root}/agents/openai.yaml`, buildAgentOverlay(root.skillId));
        } else if (missing === "eval/") {
          create(`${root.root}/eval/dataset.yaml`, buildDatasetYaml());
          create(`${root.root}/eval/rubric.yaml`, buildRubricYaml());
          create(`${root.root}/eval/baseline.json`, buildBaselineJson(root.skillId));
        }
        break;
      }

      case "scaffold_eval": {
        const root = rootFor(finding);
        if (!root) break;
        create(`${root.root}/eval/dataset.yaml`, buildDatasetYaml());
        create(`${root.root}/eval/rubric.yaml`, buildRubricYaml());
        break;
      }

      case "complete_metadata": {
        const root = rootFor(finding);
        if (!root) break;
        const state = read(`${root.root}/metadata.yaml`);
        const document = parseDocument(state.content || "{}");
        if (!isMap(document.contents)) {
          throw new FixGenerationError(`${root.root}/metadata.yaml is not a YAML mapping.`);
        }
        const map = document.contents as unknown as YAMLMap;
        const defaults: Record<string, string> = {
          skill_id: root.skillId,
          display_name: root.displayName,
          tier: root.tier,
          owner: root.owner ?? "unassigned",
          version: "0.1.0",
          status: "draft",
        };
        for (const [key, value] of Object.entries(defaults)) {
          const current = map.get(key);
          if (current === undefined || current === null || (typeof current === "string" && !current.trim())) {
            map.set(key, value);
          }
        }
        state.content = document.toString();
        break;
      }
    }
  }

  return [...states.values()]
    .filter((state) => state.content !== (state.original ?? ""))
    .map((state) => ({
      path: state.path,
      action: state.original === null ? "create" as const : "update" as const,
      previousContent: state.original,
      content: state.content,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
