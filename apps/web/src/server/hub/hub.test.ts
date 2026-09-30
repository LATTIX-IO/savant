import assert from "node:assert/strict";
import test from "node:test";

import { parse as parseYaml } from "yaml";

import { evaluateSkillPackage } from "../evaluation/scorecard.ts";
import { assessHubSkill, computeVerdict, referencedFiles, upstreamFlag } from "./analysis.ts";
import type { CatalogSkillDetail } from "./catalog-read.ts";
import { capFiles, fetchClawHubSource, fetchGithubSource, fetchSkillsShSource, parseGithubTreeUrl, parseSkillFrontmatter, type FetchLike } from "./fetchers.ts";
import { buildImportFiles, defaultImportRoot, validateImportRoot } from "./import.ts";

const SKILL_MD = `---\nname: pdf\ndescription: Extract text and tables from PDFs, fill forms, and merge documents when the user works with PDF files.\nlicense: Apache-2.0\n---\n\n# PDF\n\n${"Use scripts/extract.py to pull text. Follow the steps carefully. ".repeat(12)}\n\nSee [forms](references/forms.md).\n`;

function fakeFetch(routes: Record<string, unknown>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const impl = (async (input: string | URL) => {
    const url = String(input);
    calls.push(url);
    const key = Object.keys(routes).find((candidate) => url.startsWith(candidate));
    if (!key) return new Response("not found", { status: 404 });
    const body = routes[key];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as FetchLike & { calls: string[] };
  impl.calls = calls;
  return impl;
}

test("frontmatter parsing and referenced files", () => {
  const front = parseSkillFrontmatter(SKILL_MD);
  assert.equal(front.name, "pdf");
  assert.equal(front.license, "Apache-2.0");
  assert.deepEqual(referencedFiles(SKILL_MD).sort(), ["references/forms.md", "scripts/extract.py"]);
  assert.deepEqual(parseGithubTreeUrl("https://github.com/openclaw/openclaw/tree/main/skills/nano-pdf"), { owner: "openclaw", repo: "openclaw", ref: "main", path: "skills/nano-pdf" });
});

test("GitHub sources: SKILL.md packages under the configured roots, with their text files", async () => {
  const fetchImpl = fakeFetch({
    "https://api.github.com/repos/anthropics/skills/git/trees": { sha: "abc123def4567890", tree: [
      { path: "skills/pdf/SKILL.md", type: "blob", size: 900 },
      { path: "skills/pdf/scripts/extract.py", type: "blob", size: 100 },
      { path: "skills/pdf/logo.png", type: "blob", size: 100 },
      { path: "README.md", type: "blob", size: 10 },
      { path: "other/x/SKILL.md", type: "blob", size: 10 },
    ] },
    "https://api.github.com/repos/anthropics/skills": { default_branch: "main", stargazers_count: 1000, license: null },
    "https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/SKILL.md": SKILL_MD,
    "https://raw.githubusercontent.com/anthropics/skills/main/skills/pdf/scripts/extract.py": "print('x')\n",
  });
  const skills = await fetchGithubSource({ id: "anthropic", kind: "github", publisher: "Anthropic", config: { owner: "anthropics", repo: "skills", roots: ["skills"] }, maxSkills: 10 }, fetchImpl, {});
  assert.equal(skills.length, 1);
  const pdf = skills[0]!;
  assert.equal(pdf.canonicalKey, "gh:anthropics/skills#pdf");
  assert.deepEqual(pdf.files.map((file) => file.path), ["SKILL.md", "scripts/extract.py"]);
  assert.equal(pdf.license, "Apache-2.0");
  assert.equal(pdf.popularity.stars, 1000);
});

test("skills.sh and ClawHub sources map to the same shape; canonical keys dedupe GitHub-backed listings", async () => {
  const skillsSh = await fetchSkillsShSource({ id: "skills-sh", kind: "skills_sh", publisher: "Vercel", config: {}, maxSkills: 5 }, "oidc", fakeFetch({
    "https://skills.sh/api/v1/skills?": { data: [{ id: "anthropics/skills/pdf", slug: "pdf", source: "anthropics/skills", installs: 200000, sourceType: "github" }] },
    "https://skills.sh/api/v1/skills/audit/": { audits: [{ provider: "Socket", status: "warn", summary: "network access" }] },
    "https://skills.sh/api/v1/skills/anthropics/skills/pdf": { hash: "h1", files: [{ path: "SKILL.md", contents: SKILL_MD }, { path: "image.png", contents: "x" }] },
  }));
  assert.equal(skillsSh[0]?.canonicalKey, "gh:anthropics/skills#pdf");
  assert.equal(skillsSh[0]?.files.length, 1);
  assert.match(upstreamFlag(skillsSh[0]?.upstreamSecurity) ?? "", /Socket: warn/);

  const clawhub = await fetchClawHubSource({ id: "clawhub", kind: "clawhub", publisher: "OpenClaw", config: {}, maxSkills: 5 }, fakeFetch({
    "https://clawhub.ai/api/v1/skills?": { items: [{ ownerHandle: "alice", slug: "vetter", displayName: "Vetter", summary: "Vets skills.", stats: { downloads: 50 }, latestVersion: { version: "1.0.0", license: "MIT" } }] },
    "https://clawhub.ai/api/v1/skills/vetter/versions/1.0.0": { version: { files: [{ path: "SKILL.md", size: 900 }], security: { status: "clean" } } },
    "https://clawhub.ai/api/v1/skills/vetter/file": SKILL_MD,
  }));
  assert.equal(clawhub[0]?.externalId, "alice/vetter");
  assert.equal(clawhub[0]?.popularity.downloads, 50);
  assert.equal(upstreamFlag(clawhub[0]?.upstreamSecurity), null);
});

test("static assessment and verdicts", () => {
  const findings = assessHubSkill({ files: [{ path: "SKILL.md", content: SKILL_MD }, { path: "scripts/extract.py", content: "x" }], license: null, upstreamSecurity: { status: "suspicious" } });
  const codes = findings.map((finding) => finding.code);
  assert.ok(codes.includes("REFERENCED_FILE_MISSING") && codes.includes("EXECUTES_CODE") && codes.includes("LICENSE_UNKNOWN") && codes.includes("UPSTREAM_SECURITY_FLAG"));
  assert.ok(!codes.includes("FRONTMATTER_INCOMPLETE"));
  assert.equal(computeVerdict({ findings, safetyRecommendation: "SAFE", evalStatus: "complete", evalScore: 90 }), "caution");
  assert.equal(computeVerdict({ findings: [], safetyRecommendation: "SAFE", evalStatus: "complete", evalScore: 82 }), "validated");
  assert.equal(computeVerdict({ findings: [], safetyRecommendation: "SAFE", evalStatus: "none", evalScore: null }), "analyzed");
  assert.equal(computeVerdict({ findings: [], safetyRecommendation: "DO_NOT_INSTALL", evalStatus: "complete", evalScore: 99 }), "unsafe");
  assert.equal(computeVerdict({ findings: [], safetyRecommendation: null, evalStatus: "none", evalScore: null }), "unverified");
  assert.equal(capFiles([{ path: "b.md", content: "x" }, { path: "SKILL.md", content: "y" }])[0]?.path, "SKILL.md");
});

test("import builds a contract-shaped package with provenance, generated evals and a registry entry", () => {
  const skill = { id: "00000000-0000-0000-0000-000000000001", sourceId: "anthropic", sourceName: "Anthropic Agent Skills", trust: "official", slug: "pdf", name: "pdf", description: "PDF tools", sourceUrl: "https://github.com/anthropics/skills/tree/main/skills/pdf", version: "abc", license: "Apache-2.0", contentHash: "h", verdict: "validated", safetyRecommendation: "SAFE", evalScore: 81 } as unknown as CatalogSkillDetail;
  const root = defaultImportRoot(skill);
  assert.equal(root, "tier2/imported/anthropic/pdf");
  assert.throws(() => validateImportRoot("../etc"));
  assert.equal(validateImportRoot("/tier3/workflow/x/pdf/"), "tier3/workflow/x/pdf");

  const files = buildImportFiles({
    skill,
    files: [{ path: "SKILL.md", content: SKILL_MD }, { path: "metadata.yaml", content: "upstream: true\n" }],
    evalFiles: [
      { path: "__SKILL_ROOT__/eval/dataset.yaml", content: "eval_set_version: 0.1.0\nsamples:\n  - case_id: positive-a\n    quality: 0.9\n    format_compliance: 1\n    grounding_relevant: false\n    grounding_score: 1\n    actionability: 0.9\n    policy_compliance: true\n    latency_ms: 900\n    estimated_cost_usd: 0.001\n    human_revision_count: 0\n    verdict: pass\n" },
      { path: "__SKILL_ROOT__/eval/baseline.json", content: "{\"skill_id\":\"pdf\",\"overall_score\":1}" },
    ],
    root,
    owner: "platform",
    registry: "version: 1\nskills:\n  - skill_id: other\n    package_path: tier2/x/y/other\n",
    now: new Date("2026-09-30T00:00:00Z"),
  });
  const byPath = Object.fromEntries(files.map((file) => [file.path, file.content]));
  assert.ok(byPath[`${root}/SKILL.md`]);
  assert.ok(byPath[`${root}/source/metadata.upstream.yaml`]);
  assert.ok(byPath[`${root}/agents/openai.yaml`]);
  const metadata = parseYaml(byPath[`${root}/metadata.yaml`] as string) as { skill_id: string; owner: string; source: { hub: string; license: string; savant_verdict: string } };
  assert.equal(metadata.skill_id, "anthropic/pdf");
  assert.equal(metadata.owner, "platform");
  assert.equal(metadata.source.savant_verdict, "validated");
  assert.equal(evaluateSkillPackage(root, byPath).status, "scored");
  assert.match(byPath["registry/skills.yaml"] as string, /anthropic\/pdf/);
});
