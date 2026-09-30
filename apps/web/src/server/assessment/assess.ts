import { createHash } from "node:crypto";

import { tenantSkillRepoContract } from "@savant/schemas/tenant-skill-repo-contract";
import type { AssessmentFinding, AssessmentFixKind, AssessmentSeverity, AssessmentSummary } from "@savant/types";
import { parse as parseYaml } from "yaml";

import { inferSkillPackageRoots } from "../git/repository-reader.ts";

/**
 * Deterministic post-sync assessment of a tenant skill repository.
 *
 * It reports what Savant expects but cannot find (contract directories,
 * registry files, required package files — naming exactly which one), what is
 * inconsistent (registry vs. packages, dependencies, owners, metadata), and
 * what limits quality (thin SKILL.md, placeholders, no evaluation cases).
 * Findings carry a stable fingerprint so dismissals survive later syncs, and a
 * fix descriptor when Savant can generate the change itself.
 */

export type AssessmentInput = {
  observedPaths: readonly string[];
  files: Readonly<Record<string, string>>;
  /** Skill ids the indexer accepted in this sync. */
  indexedSkillIds?: readonly string[] | undefined;
};

export type AssessedSkillRoot = {
  root: string;
  tier: "tier1" | "tier2" | "tier3";
  inferredSkillId: string;
  inferredDisplayName: string;
  inferredOwner: string | null;
  metadata: Record<string, unknown> | null;
  missing: Array<"SKILL.md" | "metadata.yaml" | "agents/" | "eval/">;
};

export type AssessmentResult = {
  findings: AssessmentFinding[];
  summary: AssessmentSummary;
  roots: AssessedSkillRoot[];
};

const REQUIRED_METADATA_FIELDS = ["skill_id", "display_name", "tier", "owner", "version", "status"] as const;
const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const PLACEHOLDER = /<REPLACE[_A-Z]*>|\bTODO\b|\bTBD\b|lorem ipsum/i;
const EVAL_DATASET_FILE = /\/eval\/[^/]+\.(?:ya?ml|jsonl?|csv)$/i;

export function fingerprintFinding(code: string, scopeKey: string): string {
  return createHash("sha256").update(`${code}\u0000${scopeKey}`).digest("hex").slice(0, 24);
}

export function humanizeSlug(slug: string): string {
  return slug.split(/[-_]+/).filter(Boolean).map((token) => `${token[0]?.toUpperCase() ?? ""}${token.slice(1)}`).join(" ");
}

export function inferSkillIdentity(root: string): Pick<AssessedSkillRoot, "tier" | "inferredSkillId" | "inferredDisplayName" | "inferredOwner"> {
  const parts = root.split("/").filter(Boolean);
  const tier = parts[0] === "tier1" ? "tier1" : parts[0] === "tier3" ? "tier3" : "tier2";
  let inferredSkillId = root;

  if (parts[0] === "tier1" && parts[2]) {
    inferredSkillId = `tier1.${parts[2]}`;
  } else if (parts[0] === "tier2" && parts[2] && parts[3]) {
    inferredSkillId = `${parts[2]}/${parts[3]}`;
  } else if (parts[0] === "tier3" && parts[1] === "workflow" && parts[2] && parts[3]) {
    inferredSkillId = `workflow/${parts[2]}/${parts[3]}`;
  } else if (parts[0] === "tier3" && parts[1] === "personal" && parts[2] && parts[3]) {
    inferredSkillId = `personal/${parts[2]}/${parts[3]}`;
  }

  return {
    tier,
    inferredSkillId,
    inferredDisplayName: humanizeSlug(parts.at(-1) ?? root),
    inferredOwner: parts[0] === "tier3" && parts[1] === "personal" && parts[2] ? parts[2] : null,
  };
}

function safeParse(content: string | undefined): { ok: true; value: unknown } | { ok: false; error: string } | null {
  if (content === undefined) {
    return null;
  }
  try {
    return { ok: true, value: parseYaml(content) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.split("\n")[0] ?? "invalid YAML" : "invalid YAML" };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readList(document: unknown, key: string): Record<string, unknown>[] {
  const record = asRecord(document);
  const list = record ? record[key] : Array.isArray(document) ? document : null;
  return Array.isArray(list) ? list.map(asRecord).filter((entry): entry is Record<string, unknown> => entry !== null) : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null;
}

export function assessRepositorySnapshot(input: AssessmentInput): AssessmentResult {
  const findings: AssessmentFinding[] = [];
  const paths = new Set(input.observedPaths);
  const hasPrefix = (prefix: string) => input.observedPaths.some((path) => path === prefix || path.startsWith(`${prefix}/`));

  function add(finding: {
    code: string;
    severity: AssessmentSeverity;
    scope: "repository" | "skill";
    skillId?: string | null | undefined;
    path?: string | null | undefined;
    title: string;
    detail: string;
    remediation: string;
    fix?: { kind: AssessmentFixKind; description: string } | null | undefined;
  }) {
    findings.push({
      fingerprint: fingerprintFinding(finding.code, `${finding.scope}:${finding.skillId ?? ""}:${finding.path ?? ""}`),
      code: finding.code,
      severity: finding.severity,
      scope: finding.scope,
      skillId: finding.skillId ?? null,
      path: finding.path ?? null,
      title: finding.title,
      detail: finding.detail,
      remediation: finding.remediation,
      fix: finding.fix ?? null,
      status: "open",
    });
  }

  // ── Repository contract ────────────────────────────────────────────────
  for (const directory of tenantSkillRepoContract.requiredTopLevelDirectories) {
    if (!hasPrefix(directory)) {
      add({
        code: "REPO_DIRECTORY_MISSING",
        severity: "warning",
        scope: "repository",
        path: `${directory}/`,
        title: `Missing top-level directory ${directory}/`,
        detail: `The Savant skill repository contract expects a ${directory}/ directory.`,
        remediation: `Create ${directory}/ (Savant can add it with a README describing its purpose).`,
        fix: { kind: "create_directory_readme", description: `Add ${directory}/README.md` },
      });
    }
  }

  const registryDocuments = new Map<string, unknown>();
  for (const registryFile of tenantSkillRepoContract.requiredRegistryFiles) {
    const parsed = safeParse(input.files[registryFile]);
    if (!paths.has(registryFile) || parsed === null) {
      const primary = registryFile === "registry/skills.yaml";
      add({
        code: "REGISTRY_FILE_MISSING",
        severity: primary ? "blocker" : "warning",
        scope: "repository",
        path: registryFile,
        title: `Missing ${registryFile}`,
        detail: primary
          ? "Without the skills registry, Savant cannot map packages to stable skill ids, owners, or release channels."
          : `${registryFile} is part of the registry contract used for discovery, ownership, routing, and dependency resolution.`,
        remediation: `Add ${registryFile}. Savant can generate it from the skill packages it discovered.`,
        fix: { kind: "create_registry_file", description: `Generate ${registryFile} from discovered skills` },
      });
      continue;
    }
    if (!parsed.ok) {
      add({
        code: "REGISTRY_FILE_INVALID",
        severity: "blocker",
        scope: "repository",
        path: registryFile,
        title: `${registryFile} is not valid YAML`,
        detail: parsed.error,
        remediation: `Fix the YAML syntax in ${registryFile}.`,
      });
      continue;
    }
    registryDocuments.set(registryFile, parsed.value);
  }

  // ── Skill packages ─────────────────────────────────────────────────────
  const roots: AssessedSkillRoot[] = inferSkillPackageRoots(input.observedPaths).map((root) => {
    const identity = inferSkillIdentity(root);
    const missing: AssessedSkillRoot["missing"] = [];
    if (!paths.has(`${root}/SKILL.md`)) missing.push("SKILL.md");
    if (!paths.has(`${root}/metadata.yaml`)) missing.push("metadata.yaml");
    if (!hasPrefix(`${root}/agents`)) missing.push("agents/");
    if (!hasPrefix(`${root}/eval`)) missing.push("eval/");

    const parsedMetadata = safeParse(input.files[`${root}/metadata.yaml`]);
    return {
      root,
      ...identity,
      metadata: parsedMetadata?.ok ? asRecord(parsedMetadata.value) : null,
      missing,
    };
  });

  const registrySkills = readList(registryDocuments.get("registry/skills.yaml"), "skills");
  const registeredPaths = new Set(registrySkills.map((entry) => stringValue(entry.package_path)).filter((value): value is string => value !== null));
  const registeredIds = new Set(registrySkills.map((entry) => stringValue(entry.skill_id)).filter((value): value is string => value !== null));
  const knownSkillIds = new Set<string>(registeredIds);

  for (const root of roots) {
    const skillId = stringValue(root.metadata?.skill_id) ?? root.inferredSkillId;
    knownSkillIds.add(skillId);

    for (const missing of root.missing) {
      add({
        code: "SKILL_FILE_MISSING",
        severity: "blocker",
        scope: "skill",
        skillId,
        path: `${root.root}/${missing}`,
        title: `${root.inferredDisplayName} is missing ${missing}`,
        detail: `Savant skipped ${root.root} during indexing because ${missing} is missing, so the skill is not available.`,
        remediation: missing === "SKILL.md"
          ? "Add SKILL.md with the skill's instructions."
          : `Add ${missing}. Savant can scaffold a starter ${missing} for you to refine.`,
        fix: { kind: "scaffold_skill_file", description: `Scaffold ${root.root}/${missing}` },
      });
    }

    const metadataFile = input.files[`${root.root}/metadata.yaml`];
    const metadataParse = safeParse(metadataFile);
    if (metadataParse && !metadataParse.ok) {
      add({
        code: "METADATA_INVALID",
        severity: "blocker",
        scope: "skill",
        skillId,
        path: `${root.root}/metadata.yaml`,
        title: `${root.inferredDisplayName}: metadata.yaml is not valid YAML`,
        detail: metadataParse.error,
        remediation: "Fix the YAML syntax in metadata.yaml.",
      });
    } else if (root.metadata) {
      const missingFields = REQUIRED_METADATA_FIELDS.filter((field) => stringValue(root.metadata?.[field]) === null);
      if (missingFields.length > 0) {
        add({
          code: "METADATA_FIELDS_MISSING",
          severity: "warning",
          scope: "skill",
          skillId,
          path: `${root.root}/metadata.yaml`,
          title: `${root.inferredDisplayName}: metadata is missing ${missingFields.join(", ")}`,
          detail: "Savant falls back to values inferred from the package path, which can drift from what the team intends.",
          remediation: `Add ${missingFields.join(", ")} to metadata.yaml.`,
          fix: { kind: "complete_metadata", description: `Fill ${missingFields.join(", ")} from the package path` },
        });
      }

      const declaredTier = stringValue(root.metadata.tier);
      if (declaredTier && declaredTier !== root.tier) {
        add({
          code: "METADATA_TIER_MISMATCH",
          severity: "warning",
          scope: "skill",
          skillId,
          path: `${root.root}/metadata.yaml`,
          title: `${root.inferredDisplayName}: tier ${declaredTier} doesn't match its ${root.tier} location`,
          detail: "Tier drives approval and release policy; a mismatch means the wrong policy may be applied.",
          remediation: `Move the package under ${declaredTier}/ or set tier: ${root.tier}.`,
        });
      }

      const version = stringValue(root.metadata.version);
      if (version && !SEMVER.test(version)) {
        add({
          code: "METADATA_VERSION_INVALID",
          severity: "info",
          scope: "skill",
          skillId,
          path: `${root.root}/metadata.yaml`,
          title: `${root.inferredDisplayName}: version "${version}" is not semantic versioning`,
          detail: "Release comparison and version history work best with MAJOR.MINOR.PATCH versions.",
          remediation: "Use a semantic version such as 1.0.0.",
        });
      }
    }

    const markdown = input.files[`${root.root}/SKILL.md`];
    if (markdown !== undefined) {
      const body = markdown.replace(/^---[\s\S]*?---\s*/, "");
      const headings = (body.match(/^#{1,3}\s+\S/gm) ?? []).length;
      if (body.trim().length < 400 || headings < 2) {
        add({
          code: "SKILL_INSTRUCTIONS_THIN",
          severity: "warning",
          scope: "skill",
          skillId,
          path: `${root.root}/SKILL.md`,
          title: `${root.inferredDisplayName}: instructions are thin`,
          detail: `SKILL.md has ${body.trim().length} characters and ${headings} section heading${headings === 1 ? "" : "s"}; agents get little guidance on when and how to apply it.`,
          remediation: "Describe purpose, required inputs, expected output, and constraints. Skill Intelligence can propose an improved version once runs are recorded.",
        });
      }
      if (PLACEHOLDER.test(markdown)) {
        add({
          code: "SKILL_PLACEHOLDER_CONTENT",
          severity: "warning",
          scope: "skill",
          skillId,
          path: `${root.root}/SKILL.md`,
          title: `${root.inferredDisplayName}: SKILL.md still contains placeholder text`,
          detail: "Placeholder markers (TODO, TBD, <REPLACE_…>) indicate unfinished instructions.",
          remediation: "Replace the placeholders with real guidance.",
        });
      }
    }

    if (!root.missing.includes("eval/") && !input.observedPaths.some((path) => path.startsWith(`${root.root}/eval/`) && EVAL_DATASET_FILE.test(path))) {
      add({
        code: "EVAL_DATASET_MISSING",
        severity: "warning",
        scope: "skill",
        skillId,
        path: `${root.root}/eval/`,
        title: `${root.inferredDisplayName} has no evaluation cases`,
        detail: "Without a dataset Savant cannot score the skill, detect regressions, or gate improvements.",
        remediation: "Add eval/dataset.yaml and eval/rubric.yaml. Savant can scaffold starter files for you to fill in.",
        fix: { kind: "scaffold_eval", description: `Scaffold ${root.root}/eval/dataset.yaml and rubric.yaml` },
      });
    }

    if (registryDocuments.has("registry/skills.yaml") && !registeredPaths.has(root.root) && !registeredIds.has(skillId)) {
      add({
        code: "SKILL_NOT_REGISTERED",
        severity: "warning",
        scope: "skill",
        skillId,
        path: "registry/skills.yaml",
        title: `${root.inferredDisplayName} is not in registry/skills.yaml`,
        detail: `The package at ${root.root} has no registry entry, so its skill id, status, and channel are inferred.`,
        remediation: "Add a registry entry for the package.",
        fix: { kind: "register_skill", description: `Register ${skillId} in registry/skills.yaml` },
      });
    }
  }

  // ── Registry consistency ───────────────────────────────────────────────
  const rootSet = new Set(roots.map((root) => root.root));
  for (const entry of registrySkills) {
    const packagePath = stringValue(entry.package_path);
    const skillId = stringValue(entry.skill_id);
    if (packagePath && !rootSet.has(packagePath) && !hasPrefix(packagePath)) {
      add({
        code: "REGISTRY_ENTRY_ORPHANED",
        severity: "warning",
        scope: "repository",
        skillId,
        path: "registry/skills.yaml",
        title: `Registry lists ${skillId ?? packagePath}, but ${packagePath} doesn't exist`,
        detail: "The registry points to a package path that is not in the repository at this commit.",
        remediation: "Restore the package or remove the stale registry entry.",
      });
    }
  }

  for (const entry of readList(registryDocuments.get("registry/dependencies.yaml"), "dependencies")) {
    const skillId = stringValue(entry.skill_id);
    const dependsOn = Array.isArray(entry.depends_on) ? entry.depends_on.map(stringValue).filter((value): value is string => value !== null) : [];
    for (const dependency of dependsOn) {
      if (!knownSkillIds.has(dependency)) {
        add({
          code: "DEPENDENCY_UNKNOWN",
          severity: "warning",
          scope: "skill",
          skillId,
          path: "registry/dependencies.yaml",
          title: `${skillId ?? "A skill"} depends on unknown skill ${dependency}`,
          detail: "The dependency isn't defined in this repository, so it can't be resolved at release time.",
          remediation: `Add ${dependency} or correct the dependency id.`,
        });
      }
    }
  }

  const ownersDocument = registryDocuments.get("registry/owners.yaml");
  if (ownersDocument !== undefined) {
    const owned = new Set(readList(ownersDocument, "owners").flatMap((entry) => Array.isArray(entry.skills) ? entry.skills.map(stringValue) : []));
    for (const root of roots) {
      const skillId = stringValue(root.metadata?.skill_id) ?? root.inferredSkillId;
      if (!owned.has(skillId)) {
        const owner = stringValue(root.metadata?.owner) ?? root.inferredOwner;
        add({
          code: "OWNER_UNASSIGNED",
          severity: "info",
          scope: "skill",
          skillId,
          path: "registry/owners.yaml",
          title: `${root.inferredDisplayName} has no owner in registry/owners.yaml`,
          detail: "Owners receive reviews, escalations, and improvement recommendations.",
          remediation: owner ? `Add ${skillId} under owner ${owner}.` : "Assign an owner in registry/owners.yaml.",
          fix: owner ? { kind: "add_owner_entry", description: `Assign ${skillId} to ${owner}` } : null,
        });
      }
    }
  }

  // ── Summary ────────────────────────────────────────────────────────────
  const blockers = findings.filter((finding) => finding.severity === "blocker").length;
  const warnings = findings.filter((finding) => finding.severity === "warning").length;
  const infos = findings.length - blockers - warnings;
  const skillScores = roots.map((root) => {
    const skillId = stringValue(root.metadata?.skill_id) ?? root.inferredSkillId;
    const own = findings.filter((finding) => finding.scope === "skill" && finding.skillId === skillId);
    const penalty = own.reduce((sum, finding) => sum + (finding.severity === "blocker" ? 40 : finding.severity === "warning" ? 10 : 2), 0);
    return Math.max(0, 100 - penalty);
  });
  const repoPenalty = findings
    .filter((finding) => finding.scope === "repository")
    .reduce((sum, finding) => sum + (finding.severity === "blocker" ? 15 : finding.severity === "warning" ? 4 : 1), 0);
  const base = skillScores.length > 0 ? skillScores.reduce((sum, score) => sum + score, 0) / skillScores.length : 0;
  const skillsSkipped = roots.filter((root) => root.missing.length > 0).length;

  return {
    findings,
    roots,
    summary: {
      score: Math.max(0, Math.min(100, Math.round(base - repoPenalty))),
      blockers,
      warnings,
      infos,
      skillsDiscovered: roots.length,
      skillsIndexed: input.indexedSkillIds?.length ?? roots.length - skillsSkipped,
      skillsSkipped,
      fixable: findings.filter((finding) => finding.fix !== null).length,
    },
  };
}
