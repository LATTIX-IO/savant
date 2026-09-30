import assert from "node:assert/strict";
import test from "node:test";

import type { FetchLike } from "./fetchers.ts";
import { hydrateListing, listSourcePage } from "./listing.ts";

const SKILL_MD = "---\nname: tdd\ndescription: Red, green, refactor for TypeScript projects when writing new features.\n---\n\n# TDD\n";

function fakeFetch(handler: (url: string) => unknown): FetchLike {
  return (async (input: string | URL) => {
    const body = handler(String(input));
    if (body === undefined) return new Response("not found", { status: 404 });
    if (typeof body === "number") return new Response("{}", { status: body });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200 });
  }) as FetchLike;
}

test("GitHub sources list every SKILL.md package in one page and hydrate from raw files", async () => {
  const fetchImpl = fakeFetch((url) => {
    if (url.includes("/git/trees/")) return { sha: "abcdef1234567890", tree: [
      { path: "skills/engineering/tdd/SKILL.md", type: "blob", size: 100 },
      { path: "skills/engineering/tdd/references/cycle.md", type: "blob", size: 10 },
      { path: "skills/writing/prose/SKILL.md", type: "blob", size: 100 },
    ] };
    if (url.endsWith("/repos/mattpocock/skills")) return { default_branch: "main", stargazers_count: 272830, license: { spdx_id: "MIT" } };
    if (url.includes("raw.githubusercontent.com") && url.endsWith("SKILL.md")) return SKILL_MD;
    if (url.includes("raw.githubusercontent.com")) return "cycle";
    return undefined;
  });
  const page = await listSourcePage({ id: "mattpocock", kind: "github", publisher: "Matt Pocock", config: { owner: "mattpocock", repo: "skills", roots: ["skills"] }, maxSkills: 100000 }, null, { fetchImpl, env: {} });
  assert.equal(page.nextCursor, null);
  assert.deepEqual(page.listings.map((listing) => listing.slug), ["tdd", "prose"]);
  assert.equal(page.listings[0]?.license, "MIT");
  assert.deepEqual(page.listings[0]?.tags, ["engineering"]);
  const skill = await hydrateListing(page.listings[0]!, { fetchImpl, env: {} });
  assert.deepEqual(skill?.files.map((file) => file.path), ["SKILL.md", "references/cycle.md"]);
  assert.equal(skill?.name, "tdd");
});

test("skills.sh and ClawHub page through their catalogs; quota exhaustion pauses at the same cursor", async () => {
  const skillsSh = await listSourcePage({ id: "skills-sh", kind: "skills_sh", publisher: "Vercel", config: {}, maxSkills: 100000 }, "3", {
    fetchImpl: fakeFetch((url) => (url.includes("page=3") ? { data: [{ id: "a/b/c", slug: "c", source: "a/b", installs: 9, sourceType: "github" }], pagination: { hasMore: true, total: 9000 } } : undefined)),
    skillsShToken: async () => "oidc",
  });
  assert.equal(skillsSh.nextCursor, "4");
  assert.equal(skillsSh.total, 9000);
  assert.equal(skillsSh.listings[0]?.canonicalKey, "gh:a/b#c");

  const clawhub = await listSourcePage({ id: "clawhub", kind: "clawhub", publisher: "OpenClaw", config: {}, maxSkills: 100000 }, "cur1", {
    fetchImpl: fakeFetch((url) => (url.includes("cursor=cur1") ? { items: [{ ownerHandle: "x", slug: "y", stats: { downloads: 5 }, latestVersion: { version: "1.0.0" } }, { ownerHandle: "x", slug: "no-version" }], nextCursor: null } : undefined)),
  });
  assert.equal(clawhub.nextCursor, null);
  assert.equal(clawhub.listings.length, 1);
  assert.equal(clawhub.listings[0]?.popularityScore, 5);

  const limited = await listSourcePage({ id: "clawhub", kind: "clawhub", publisher: "OpenClaw", config: {}, maxSkills: 100000 }, "cur9", { fetchImpl: fakeFetch(() => 429) });
  assert.equal(limited.quotaExhausted, true);
  assert.equal(limited.nextCursor, "cur9");
});

test("SkillsMP walks each configured query page by page", async () => {
  const source = { id: "skillsmp", kind: "skillsmp" as const, publisher: "SkillsMP", config: { queries: ["agent", "security"] }, maxSkills: 100000 };
  const full = Array.from({ length: 100 }, (_, index) => ({ id: `s${index}`, name: `s${index}`, githubUrl: `https://github.com/o/r/tree/main/skills/s${index}`, stars: 100 - index }));
  const first = await listSourcePage(source, null, { fetchImpl: fakeFetch(() => ({ data: { skills: full } })), env: {} });
  assert.deepEqual(JSON.parse(first.nextCursor ?? "{}"), { q: 0, page: 2 });
  const last = await listSourcePage(source, JSON.stringify({ q: 1, page: 1 }), { fetchImpl: fakeFetch(() => ({ data: { skills: full.slice(0, 3) } })), env: {} });
  assert.equal(last.nextCursor, null);
  assert.equal(last.listings.length, 3);
});
