import assert from "node:assert/strict";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import { parseRepositoryIndexSnapshot } from "../control-plane/repository-index.ts";
import { VALID_SKILL_FILES } from "../git/testing/fixtures.ts";
import { assessRepositorySnapshot } from "./assess.ts";
import { buildFixChanges } from "./fixes.ts";

const CONTRACT_DIRS = ["tier1/.keep", "tier3/.keep", "evals/.keep", "templates/.keep"];

function withDirectories(files: Record<string, string>): string[] {
  const paths = new Set<string>(CONTRACT_DIRS);
  for (const file of Object.keys(files)) {
    paths.add(file);
    const parts = file.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      paths.add(parts.slice(0, index).join("/"));
    }
  }
  return [...paths].sort();
}

const LONG_SKILL = `# Contract Review Assistant\n\n## Summary\n\n${"Reviews contracts and highlights risky clauses with clear explanations. ".repeat(6)}\n\n## Constraints\n\n- Stay in scope.\n`;

test("a complete, well-formed repository has no blockers or warnings", () => {
  const files = { ...VALID_SKILL_FILES, "tier2/methodology/legal/contract-review-assistant/SKILL.md": LONG_SKILL };
  const result = assessRepositorySnapshot({ observedPaths: withDirectories(files), files });
  assert.deepEqual(result.findings.filter((finding) => finding.severity !== "info").map((finding) => finding.code), []);
  assert.equal(result.summary.skillsDiscovered, 1);
  assert.equal(result.summary.skillsSkipped, 0);
  assert.ok(result.summary.score >= 90, `score ${result.summary.score}`);
});

test("a skipped skill names exactly which required files are missing, and they can be scaffolded", () => {
  const files = { ...VALID_SKILL_FILES };
  delete files["tier2/methodology/legal/contract-review-assistant/agents/reviewer.md"];
  delete files["tier2/methodology/legal/contract-review-assistant/eval/cases.yaml"];
  const observedPaths = withDirectories(files);

  // The indexer only says "one or more required files are missing".
  assert.equal(parseRepositoryIndexSnapshot({ defaultBranch: "main", commitSha: "a", observedPaths, files }).skills.length, 0);

  const result = assessRepositorySnapshot({ observedPaths, files });
  const missing = result.findings.filter((finding) => finding.code === "SKILL_FILE_MISSING");
  assert.deepEqual(missing.map((finding) => finding.path).sort(), [
    "tier2/methodology/legal/contract-review-assistant/agents/",
    "tier2/methodology/legal/contract-review-assistant/eval/",
  ]);
  assert.ok(missing.every((finding) => finding.severity === "blocker" && finding.fix?.kind === "scaffold_skill_file"));
  assert.equal(result.summary.skillsSkipped, 1);

  const changes = buildFixChanges({ findings: missing, roots: result.roots, files });
  assert.deepEqual(changes.map((change) => change.path), [
    "tier2/methodology/legal/contract-review-assistant/agents/openai.yaml",
    "tier2/methodology/legal/contract-review-assistant/eval/baseline.json",
    "tier2/methodology/legal/contract-review-assistant/eval/dataset.yaml",
    "tier2/methodology/legal/contract-review-assistant/eval/rubric.yaml",
  ]);
  assert.ok(changes.every((change) => change.action === "create"));

  // After applying the fix, the indexer accepts the skill.
  const fixed = { ...files, ...Object.fromEntries(changes.map((change) => [change.path, change.content])) };
  const reindexed = parseRepositoryIndexSnapshot({ defaultBranch: "main", commitSha: "b", observedPaths: withDirectories(fixed), files: fixed });
  assert.equal(reindexed.skills.length, 1);
});

test("missing registry and contract directories are raised, and the registry is generated from discovered skills", () => {
  const files = Object.fromEntries(Object.entries(VALID_SKILL_FILES).filter(([path]) => !path.startsWith("registry/")));
  const observedPaths = withDirectories(files).filter((path) => !path.startsWith("templates"));
  const result = assessRepositorySnapshot({ observedPaths, files });
  const codes = result.findings.map((finding) => `${finding.code}:${finding.path}`);

  assert.ok(codes.includes("REGISTRY_FILE_MISSING:registry/skills.yaml"));
  assert.ok(codes.includes("REPO_DIRECTORY_MISSING:templates/"));
  assert.equal(result.findings.find((finding) => finding.path === "registry/skills.yaml")?.severity, "blocker");

  const changes = buildFixChanges({ findings: result.findings, roots: result.roots, files });
  const skillsYaml = parseYaml(changes.find((change) => change.path === "registry/skills.yaml")?.content ?? "") as { skills: Array<{ skill_id: string; package_path: string }> };
  assert.deepEqual(skillsYaml.skills.map((entry) => [entry.skill_id, entry.package_path]), [
    ["legal/contract-review-assistant", "tier2/methodology/legal/contract-review-assistant"],
  ]);
  const owners = parseYaml(changes.find((change) => change.path === "registry/owners.yaml")?.content ?? "") as { owners: Array<{ owner: string; skills: string[] }> };
  assert.deepEqual(owners.owners, [{ owner: "legal-ops", skills: ["legal/contract-review-assistant"] }]);
  assert.ok(changes.some((change) => change.path === "templates/README.md"));
});

test("unregistered skills, orphaned entries, unknown dependencies and incomplete metadata are reported; fixes preserve comments", () => {
  const files: Record<string, string> = {
    ...VALID_SKILL_FILES,
    "registry/skills.yaml": "# Canonical registry — keep sorted\nversion: 1\nskills:\n  - skill_id: \"legal/removed\"\n    package_path: \"tier2/methodology/legal/removed\"\n",
    "registry/dependencies.yaml": "version: 1\ndependencies:\n  - skill_id: \"legal/contract-review-assistant\"\n    depends_on:\n      - \"tier1.does-not-exist\"\n",
    "tier2/methodology/legal/contract-review-assistant/metadata.yaml": "# owned by legal\nskill_id: \"legal/contract-review-assistant\"\ntier: tier1\nversion: \"v2\"\n",
  };
  const result = assessRepositorySnapshot({ observedPaths: withDirectories(files), files });
  const codes = new Set(result.findings.map((finding) => finding.code));
  for (const code of ["SKILL_NOT_REGISTERED", "REGISTRY_ENTRY_ORPHANED", "DEPENDENCY_UNKNOWN", "METADATA_FIELDS_MISSING", "METADATA_TIER_MISMATCH", "METADATA_VERSION_INVALID", "SKILL_INSTRUCTIONS_THIN"]) {
    assert.ok(codes.has(code), `missing ${code}`);
  }

  const fixable = result.findings.filter((finding) => finding.code === "SKILL_NOT_REGISTERED" || finding.code === "METADATA_FIELDS_MISSING");
  const changes = buildFixChanges({ findings: fixable, roots: result.roots, files });
  const registry = changes.find((change) => change.path === "registry/skills.yaml");
  assert.equal(registry?.action, "update");
  assert.match(registry?.content ?? "", /# Canonical registry — keep sorted/);
  assert.equal((parseYaml(registry?.content ?? "") as { skills: unknown[] }).skills.length, 2);
  const metadata = changes.find((change) => change.path.endsWith("metadata.yaml"));
  assert.match(metadata?.content ?? "", /# owned by legal/);
  assert.equal((parseYaml(metadata?.content ?? "") as { display_name: string }).display_name, "Contract Review Assistant");
  // Existing values are never overwritten by inferred defaults.
  assert.equal((parseYaml(metadata?.content ?? "") as { tier: string }).tier, "tier1");
});

test("fingerprints are stable across syncs so dismissals persist", () => {
  const files = { ...VALID_SKILL_FILES };
  delete files["tier2/methodology/legal/contract-review-assistant/eval/cases.yaml"];
  const first = assessRepositorySnapshot({ observedPaths: withDirectories(files), files });
  const second = assessRepositorySnapshot({ observedPaths: withDirectories(files), files });
  assert.deepEqual(first.findings.map((finding) => finding.fingerprint), second.findings.map((finding) => finding.fingerprint));
  assert.equal(new Set(first.findings.map((finding) => finding.fingerprint)).size, first.findings.length);
});
