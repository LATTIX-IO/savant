import type { AssessmentFinding, ChangeProposal } from "@savant/types";
import { stringify as stringifyYaml } from "yaml";

import { inferSkillIdentity, type AssessedSkillRoot } from "../assessment/assess.ts";
import { buildFixChanges } from "../assessment/fixes.ts";
import { buildAgentOverlay, buildBaselineJson, buildDatasetYaml, buildRubricYaml } from "../control-plane/skill-scaffold.ts";
import { assertGitPermission, type GitActor } from "../git/access-control.ts";
import { GitProviderError } from "../git/errors.ts";
import type { GitRuntime } from "../git/runtime.ts";
import { openRepositoryFiles } from "../jobs/repository-files.ts";
import { getCatalogSkill, type CatalogSkillDetail } from "./catalog-read.ts";
import { EVAL_ROOT_PLACEHOLDER } from "./jobs.ts";
import { hydrateListing } from "./listing.ts";
import { createHubStore } from "./store.ts";

type Sql = import("postgres").Sql;

/**
 * Imports a catalog skill into a tenant repository as a change proposal:
 * the upstream package, a metadata.yaml recording provenance and Savant's
 * analysis, an agent overlay, evaluations (the live-generated set when one
 * exists), and a registry entry. Nothing is written until the proposal is
 * approved, which opens a pull request under the repository's own rules.
 */

const slugPart = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "skill";

export function defaultImportRoot(skill: Pick<CatalogSkillDetail, "sourceId" | "slug">): string {
  return `tier2/imported/${slugPart(skill.sourceId)}/${slugPart(skill.slug)}`;
}

export function validateImportRoot(root: string): string {
  const normalized = root.trim().replace(/^\/+|\/+$/g, "");
  const parts = normalized.split("/");
  if (!/^tier[123]$/.test(parts[0] ?? "") || parts.length < 3 || parts.some((part) => !/^[a-z0-9][a-z0-9._-]*$/i.test(part) || part === "..")) {
    throw new GitProviderError("INVALID_REQUEST", "The target path must look like tier2/<category>/<domain>/<skill> using letters, numbers, dots, dashes or underscores.");
  }
  return normalized;
}

export function buildImportFiles(input: {
  skill: CatalogSkillDetail;
  files: ReadonlyArray<{ path: string; content: string }>;
  evalFiles: ReadonlyArray<{ path: string; content: string }>;
  root: string;
  owner: string | null;
  registry: string | null;
  now: Date;
}): Array<{ path: string; content: string }> {
  const identity = inferSkillIdentity(input.root);
  const out = new Map<string, string>();
  for (const file of input.files) {
    // The package's own metadata is kept alongside Savant's contract metadata.
    const path = file.path === "metadata.yaml" ? "source/metadata.upstream.yaml" : file.path;
    out.set(`${input.root}/${path}`, file.content);
  }

  const skill = input.skill;
  out.set(`${input.root}/metadata.yaml`, stringifyYaml({
    skill_id: identity.inferredSkillId,
    display_name: skill.name,
    tier: identity.tier,
    owner: input.owner ?? "unassigned",
    version: "0.1.0",
    status: "draft",
    description: skill.description ?? undefined,
    source: {
      catalog: "savant",
      hub: skill.sourceName,
      trust: skill.trust,
      url: skill.sourceUrl ?? undefined,
      upstream_version: skill.version ?? undefined,
      license: skill.license ?? "unknown",
      content_hash: skill.contentHash ?? undefined,
      imported_at: input.now.toISOString(),
      savant_verdict: skill.verdict,
      safety: skill.safetyRecommendation ?? "not scanned",
      live_eval_score: skill.evalScore ?? undefined,
    },
  }, { lineWidth: 100 }));

  if (![...out.keys()].some((path) => path.startsWith(`${input.root}/agents/`))) {
    out.set(`${input.root}/agents/openai.yaml`, buildAgentOverlay(identity.inferredSkillId));
  }

  const upstreamEval = [...out.keys()].some((path) => path.startsWith(`${input.root}/eval/`));
  if (!upstreamEval) {
    if (input.evalFiles.length > 0) {
      for (const file of input.evalFiles) {
        out.set(file.path.replace(EVAL_ROOT_PLACEHOLDER, input.root), file.content.split(EVAL_ROOT_PLACEHOLDER).join(input.root));
      }
    } else {
      out.set(`${input.root}/eval/dataset.yaml`, buildDatasetYaml());
      out.set(`${input.root}/eval/rubric.yaml`, buildRubricYaml());
      out.set(`${input.root}/eval/baseline.json`, buildBaselineJson(identity.inferredSkillId));
    }
  }

  if (input.registry !== null) {
    const root: AssessedSkillRoot = {
      root: input.root,
      ...identity,
      inferredDisplayName: skill.name,
      inferredOwner: input.owner,
      metadata: { skill_id: identity.inferredSkillId, display_name: skill.name, tier: identity.tier, owner: input.owner ?? "unassigned", version: "0.1.0", status: "draft" },
      missing: [],
    };
    const finding: AssessmentFinding = {
      fingerprint: "import", code: "SKILL_NOT_REGISTERED", severity: "warning", scope: "skill", skillId: identity.inferredSkillId,
      path: "registry/skills.yaml", title: "", detail: "", remediation: "", fix: { kind: "register_skill", description: "" }, status: "open",
    };
    for (const change of buildFixChanges({ findings: [finding], roots: [root], files: { "registry/skills.yaml": input.registry } })) {
      out.set(change.path, change.content);
    }
  }

  return [...out.entries()].map(([path, content]) => ({ path, content }));
}

export async function proposeCatalogImport(sql: Sql, runtime: GitRuntime, actor: GitActor, input: {
  hubSkillId: string;
  repositoryId: string;
  targetRoot?: string | null | undefined;
  owner?: string | null | undefined;
}): Promise<{ proposal: ChangeProposal; root: string }> {
  assertGitPermission(actor, "connect_repository");
  const skill = await getCatalogSkill(sql, input.hubSkillId);
  if (!skill) {
    throw new GitProviderError("INVALID_REQUEST", "That catalog skill wasn't found.", { status: 404 });
  }
  if (skill.verdict === "unsafe") {
    throw new GitProviderError("INVALID_REQUEST", "This skill failed Savant's safety scan (SkillSpector: do not install) and can't be imported.", { status: 409 });
  }
  const root = validateImportRoot(input.targetRoot || defaultImportRoot(skill));
  const repo = await openRepositoryFiles(runtime, actor.organizationId, input.repositoryId);
  const tree = await repo.listFiles();
  if (tree.has(`${root}/SKILL.md`)) {
    throw new GitProviderError("INVALID_REQUEST", `${root} already contains a skill. Choose another target path.`, { status: 409 });
  }
  const registry = await repo.read("registry/skills.yaml");
  const store = createHubStore(sql);
  const [files, evalRows] = await Promise.all([
    store.filesFor(skill.id),
    sql<{ eval_files: Array<{ path: string; content: string }> | null }[]>`select eval_files from hub_skill_analyses where hub_skill_id = ${skill.id}`,
  ]);
  let packageFiles: ReadonlyArray<{ path: string; content: string }> = files;
  if (!packageFiles.some((file) => file.path === "SKILL.md")) {
    const [row] = await sql<Array<{ locator: Record<string, unknown> | null }>>`select locator from hub_skills where id = ${skill.id}`;
    const fetched = row?.locator ? await hydrateListing({
      externalId: skill.id, canonicalKey: null, slug: skill.slug, name: skill.name, description: skill.description, publisher: skill.publisher,
      sourceUrl: skill.sourceUrl, repository: skill.repository, path: skill.path, version: skill.version, license: skill.license,
      popularity: skill.popularity, popularityScore: 0, tags: skill.tags, locator: row.locator,
    }, { skillsShToken: async () => (await import("@vercel/oidc")).getVercelOidcToken() }).catch(() => null) : null;
    if (!fetched) {
      throw new GitProviderError("INVALID_REQUEST", "This skill's package couldn't be fetched from its source right now. Try again shortly.", { status: 502 });
    }
    packageFiles = fetched.files;
  }
  const owner = input.owner?.trim().slice(0, 80) || null;
  const changes = buildImportFiles({ skill, files: packageFiles, evalFiles: evalRows[0]?.eval_files ?? [], root, owner, registry, now: new Date() });

  const lines = [
    `Imports **${skill.name}** from ${skill.sourceName}${skill.sourceUrl ? ` (${skill.sourceUrl})` : ""} into \`${root}\`.`,
    "",
    `- Savant verdict: **${skill.verdict}**${skill.safetyRecommendation ? ` · SkillSpector: ${skill.safetyRecommendation.replace(/_/g, " ").toLowerCase()}${skill.riskScore !== null ? ` (risk ${skill.riskScore}/100)` : ""}` : " · not yet safety-scanned"}`,
    `- Live evaluation: ${skill.evalScore !== null ? `${skill.evalScore}/100 (LLM-drafted, Jev-validated cases included under eval/)` : "not run; starter eval files are scaffolded"}`,
    `- License: ${skill.license ?? "not declared — confirm reuse rights before merging"}`,
    "",
    "The skill is added with status `draft`. Review the instructions and evaluations before promoting it.",
  ];
  const proposal = await runtime.assessments.proposeFileEdits(actor, input.repositoryId, {
    title: `Import ${skill.name} from ${skill.sourceName}`,
    body: lines.join("\n"),
    files: changes,
  });
  return { proposal, root };
}
