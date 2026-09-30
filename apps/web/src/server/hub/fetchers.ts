import { createHash } from "node:crypto";

import { parse as parseYaml } from "yaml";

/**
 * Fetchers for public skill hubs. Each returns the top skills of a source
 * with their package files (text only, size-capped), normalised to one shape.
 *
 * - github:    a repository's SKILL.md packages (tree API + raw files)
 * - skills_sh: skills.sh leaderboard and file contents (v1 API, Vercel OIDC)
 * - clawhub:   ClawHub registry, most downloaded, non-suspicious only
 * - skillsmp:  SkillsMP search by stars; files from the linked GitHub folder
 */

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type HubSourceConfig = {
  id: string;
  kind: "github" | "skills_sh" | "clawhub" | "skillsmp";
  publisher: string;
  config: Record<string, unknown>;
  maxSkills: number;
};

export type HubFile = { path: string; content: string };

export type FetchedHubSkill = {
  externalId: string;
  canonicalKey: string | null;
  slug: string;
  name: string;
  description: string | null;
  publisher: string | null;
  sourceUrl: string | null;
  repository: string | null;
  path: string | null;
  version: string | null;
  license: string | null;
  popularity: Record<string, number>;
  rank: number;
  tags: string[];
  upstreamSecurity: unknown;
  files: HubFile[];
};

export class HubFetchError extends Error {
  readonly code = "HUB_FETCH_FAILED";
}

export const MAX_FILE_BYTES = 200 * 1024;
export const MAX_SKILL_BYTES = 1_500_000;
export const MAX_SKILL_FILES = 60;
export const TEXT_FILE = /\.(md|markdown|txt|ya?ml|json|toml|py|sh|bash|js|mjs|cjs|ts|tsx|jsx|ps1|rb|go|rs|sql|html|css|csv|xml|ini|cfg)$|(^|\/)(LICENSE|Makefile|Dockerfile|requirements[^/]*\.txt)$/i;

const USER_AGENT = "savant-skill-hub (+https://savantrepo.com/catalog)";

export function contentHash(files: readonly HubFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => left.path.localeCompare(right.path))) {
    hash.update(file.path).update("\u0000").update(file.content).update("\u0000");
  }
  return hash.digest("hex").slice(0, 40);
}

export type SkillFrontmatter = { name: string | null; description: string | null; license: string | null; version: string | null; body: string; data: Record<string, unknown> };

export function parseSkillFrontmatter(markdown: string): SkillFrontmatter {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  let data: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed = parseYaml(match[1] as string) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) data = parsed as Record<string, unknown>;
    } catch {
      data = {};
    }
  }
  const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : typeof value === "number" ? String(value) : null);
  const metadata = (data.metadata && typeof data.metadata === "object" ? data.metadata : {}) as Record<string, unknown>;
  return {
    name: text(data.name),
    description: text(data.description),
    license: text(data.license) ?? text(metadata.license),
    version: text(data.version) ?? text(metadata.version),
    body: match ? markdown.slice(match[0].length) : markdown,
    data,
  };
}

async function getJson(fetchImpl: FetchLike, url: string, headers: Record<string, string> = {}, timeoutMs = 20_000): Promise<{ status: number; body: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { headers: { accept: "application/json", "user-agent": USER_AGENT, ...headers }, signal: controller.signal });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON body (error page).
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function getText(fetchImpl: FetchLike, url: string, headers: Record<string, string> = {}): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT, ...headers }, signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    return text.length > MAX_FILE_BYTES ? null : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index] as T, index);
    }
  }));
  return results;
}

/** Applies the per-skill caps and makes sure SKILL.md comes first. */
export function capFiles(files: HubFile[]): HubFile[] {
  const sorted = [...files].sort((left, right) => (left.path === "SKILL.md" ? -1 : right.path === "SKILL.md" ? 1 : left.path.localeCompare(right.path)));
  const kept: HubFile[] = [];
  let bytes = 0;
  for (const file of sorted) {
    if (kept.length >= MAX_SKILL_FILES) break;
    if (file.content.length > MAX_FILE_BYTES || bytes + file.content.length > MAX_SKILL_BYTES) continue;
    bytes += file.content.length;
    kept.push(file);
  }
  return kept;
}

function describe(files: HubFile[], fallbackName: string) {
  const skillMd = files.find((file) => file.path === "SKILL.md")?.content ?? "";
  const front = parseSkillFrontmatter(skillMd);
  return { front, name: front.name ?? fallbackName };
}

// ── GitHub repositories ─────────────────────────────────────────────────

function githubHeaders(env: Record<string, string | undefined>): Record<string, string> {
  const token = env.GITHUB_PUBLIC_TOKEN?.trim();
  return { accept: "application/vnd.github+json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

export const canonicalGithubKey = (owner: string, repo: string, skillName: string) => `gh:${owner.toLowerCase()}/${repo.toLowerCase()}#${skillName.toLowerCase()}`;

export async function fetchGithubSource(source: HubSourceConfig, fetchImpl: FetchLike = fetch, env: Record<string, string | undefined> = process.env): Promise<FetchedHubSkill[]> {
  const owner = String(source.config.owner ?? "");
  const repo = String(source.config.repo ?? "");
  const roots = Array.isArray(source.config.roots) ? source.config.roots.map(String) : [""];
  if (!owner || !repo) throw new HubFetchError(`Source ${source.id} is missing owner/repo.`);

  const meta = await getJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}`, githubHeaders(env));
  if (meta.status !== 200) throw new HubFetchError(`GitHub returned ${meta.status} for ${owner}/${repo}${meta.status === 403 ? " (rate limited; set GITHUB_PUBLIC_TOKEN)" : ""}.`);
  const repoInfo = meta.body as { default_branch?: string; stargazers_count?: number; license?: { spdx_id?: string } | null; html_url?: string };
  const branch = String(source.config.ref ?? repoInfo.default_branch ?? "main");

  const treeResponse = await getJson(fetchImpl, `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, githubHeaders(env), 30_000);
  if (treeResponse.status !== 200) throw new HubFetchError(`GitHub tree returned ${treeResponse.status} for ${owner}/${repo}.`);
  const tree = (treeResponse.body as { sha?: string; tree?: Array<{ path: string; type: string; size?: number }> });
  const blobs = (tree.tree ?? []).filter((entry) => entry.type === "blob");
  const inRoots = (path: string) => roots.some((root) => root === "" || path === root || path.startsWith(`${root}/`));
  const skillDirs = blobs
    .filter((entry) => entry.path.endsWith("/SKILL.md") && inRoots(entry.path))
    .map((entry) => entry.path.slice(0, -"/SKILL.md".length))
    .sort()
    .slice(0, source.maxSkills);

  const repoLicense = repoInfo.license?.spdx_id && repoInfo.license.spdx_id !== "NOASSERTION" ? repoInfo.license.spdx_id : null;
  const version = tree.sha?.slice(0, 12) ?? null;

  const skills = await mapLimit(skillDirs, 6, async (dir, index): Promise<FetchedHubSkill | null> => {
    const prefix = `${dir}/`;
    const entries = blobs.filter((entry) => entry.path.startsWith(prefix) && TEXT_FILE.test(entry.path) && (entry.size ?? 0) <= MAX_FILE_BYTES).slice(0, MAX_SKILL_FILES);
    const files = (await mapLimit(entries, 6, async (entry) => {
      const content = await getText(fetchImpl, `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`);
      return content === null ? null : { path: entry.path.slice(prefix.length), content };
    })).filter((file): file is HubFile => file !== null);
    if (!files.some((file) => file.path === "SKILL.md")) return null;
    const baseName = dir.split("/").at(-1) ?? dir;
    const { front, name } = describe(files, baseName);
    const licenseFile = files.find((file) => /^LICENSE/i.test(file.path));
    return {
      externalId: dir,
      canonicalKey: canonicalGithubKey(owner, repo, baseName),
      slug: baseName,
      name,
      description: front.description,
      publisher: source.publisher,
      sourceUrl: `https://github.com/${owner}/${repo}/tree/${branch}/${dir}`,
      repository: `${owner}/${repo}`,
      path: dir,
      version: front.version ?? version,
      license: front.license ?? (licenseFile ? "See LICENSE" : repoLicense),
      popularity: { stars: repoInfo.stargazers_count ?? 0 },
      rank: index + 1,
      tags: dir.split("/").slice(0, -1).filter((part) => part && !part.startsWith(".") && !roots.includes(part)),
      upstreamSecurity: null,
      files: capFiles(files),
    };
  });
  return skills.filter((skill): skill is FetchedHubSkill => skill !== null);
}

// ── skills.sh ───────────────────────────────────────────────────────────

type SkillsShEntry = { id: string; slug: string; name?: string; source: string; installs?: number; sourceType?: string; url?: string; installUrl?: string };

export async function fetchSkillsShSource(source: HubSourceConfig, token: string, fetchImpl: FetchLike = fetch): Promise<FetchedHubSkill[]> {
  const auth = { authorization: `Bearer ${token}` };
  const view = String(source.config.view ?? "all-time");
  const list = await getJson(fetchImpl, `https://skills.sh/api/v1/skills?view=${encodeURIComponent(view)}&per_page=${Math.min(500, source.maxSkills)}&page=0`, auth);
  if (list.status !== 200) throw new HubFetchError(`skills.sh returned ${list.status}: ${typeof list.body === "object" ? JSON.stringify(list.body).slice(0, 200) : ""}`);
  const entries = ((list.body as { data?: SkillsShEntry[] }).data ?? []).slice(0, source.maxSkills);

  const skills = await mapLimit(entries, 4, async (entry, index): Promise<FetchedHubSkill | null> => {
    const detail = await getJson(fetchImpl, `https://skills.sh/api/v1/skills/${entry.source.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(entry.slug)}`, auth);
    if (detail.status !== 200) return null;
    const body = detail.body as { hash?: string; files?: Array<{ path: string; contents?: string }> };
    const files = (body.files ?? [])
      .filter((file) => typeof file.contents === "string" && TEXT_FILE.test(file.path))
      .map((file) => ({ path: file.path.replace(/^\.?\//, ""), content: file.contents as string }));
    if (!files.some((file) => file.path === "SKILL.md")) return null;
    const audit = await getJson(fetchImpl, `https://skills.sh/api/v1/skills/audit/${entry.source.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(entry.slug)}`, auth).catch(() => null);
    const { front, name } = describe(files, entry.name ?? entry.slug);
    const [owner, repo] = entry.source.split("/");
    return {
      externalId: entry.id,
      canonicalKey: entry.sourceType === "github" && owner && repo ? canonicalGithubKey(owner, repo, entry.slug) : `skills.sh:${entry.id}`,
      slug: entry.slug,
      name,
      description: front.description,
      publisher: owner ?? entry.source,
      sourceUrl: entry.url ?? `https://skills.sh/${entry.id}`,
      repository: entry.sourceType === "github" ? entry.source : null,
      path: null,
      version: front.version ?? body.hash?.slice(0, 12) ?? null,
      license: front.license,
      popularity: { installs: entry.installs ?? 0 },
      rank: index + 1,
      tags: [],
      upstreamSecurity: audit && audit.status === 200 ? audit.body : null,
      files: capFiles(files),
    };
  });
  return skills.filter((skill): skill is FetchedHubSkill => skill !== null);
}

// ── ClawHub ─────────────────────────────────────────────────────────────

type ClawHubItem = {
  ownerHandle: string;
  slug: string;
  displayName?: string;
  summary?: string | null;
  topics?: string[];
  stats?: Record<string, number>;
  latestVersion?: { version?: string; license?: string | null } | null;
};

export async function fetchClawHubSource(source: HubSourceConfig, fetchImpl: FetchLike = fetch): Promise<FetchedHubSkill[]> {
  const sort = String(source.config.sort ?? "downloads");
  const list = await getJson(fetchImpl, `https://clawhub.ai/api/v1/skills?limit=${Math.min(100, source.maxSkills)}&sort=${encodeURIComponent(sort)}&nonSuspiciousOnly=true`);
  if (list.status !== 200) throw new HubFetchError(`ClawHub returned ${list.status}.`);
  const items = ((list.body as { items?: ClawHubItem[] }).items ?? []).slice(0, source.maxSkills);

  const skills = await mapLimit(items, 4, async (item, index): Promise<FetchedHubSkill | null> => {
    const version = item.latestVersion?.version;
    if (!version) return null;
    const owner = encodeURIComponent(item.ownerHandle);
    const detail = await getJson(fetchImpl, `https://clawhub.ai/api/v1/skills/${encodeURIComponent(item.slug)}/versions/${encodeURIComponent(version)}?owner=${owner}`);
    if (detail.status !== 200) return null;
    const versionInfo = (detail.body as { version?: { files?: Array<{ path: string; size?: number }>; security?: unknown; license?: string | null } }).version ?? {};
    const entries = (versionInfo.files ?? []).filter((file) => TEXT_FILE.test(file.path) && (file.size ?? 0) <= MAX_FILE_BYTES).slice(0, MAX_SKILL_FILES);
    const files = (await mapLimit(entries, 4, async (file) => {
      const content = await getText(fetchImpl, `https://clawhub.ai/api/v1/skills/${encodeURIComponent(item.slug)}/file?path=${encodeURIComponent(file.path)}&version=${encodeURIComponent(version)}&owner=${owner}`);
      return content === null ? null : { path: file.path.replace(/^\.?\//, ""), content };
    })).filter((file): file is HubFile => file !== null);
    if (!files.some((file) => file.path === "SKILL.md")) return null;
    const { front, name } = describe(files, item.displayName ?? item.slug);
    return {
      externalId: `${item.ownerHandle}/${item.slug}`,
      canonicalKey: `clawhub:${item.ownerHandle.toLowerCase()}/${item.slug.toLowerCase()}`,
      slug: item.slug,
      name: item.displayName ?? name,
      description: item.summary ?? front.description,
      publisher: item.ownerHandle,
      sourceUrl: `https://clawhub.ai/${item.ownerHandle}/skills/${item.slug}`,
      repository: null,
      path: null,
      version,
      license: item.latestVersion?.license ?? versionInfo.license ?? front.license,
      popularity: { downloads: item.stats?.downloads ?? 0, installs: item.stats?.installs ?? 0, stars: item.stats?.stars ?? 0 },
      rank: index + 1,
      tags: item.topics ?? [],
      upstreamSecurity: versionInfo.security ?? null,
      files: capFiles(files),
    };
  });
  return skills.filter((skill): skill is FetchedHubSkill => skill !== null);
}

// ── SkillsMP ────────────────────────────────────────────────────────────

type SkillsMpItem = { id: string; name: string; author?: string; description?: string; githubUrl?: string; skillUrl?: string; stars?: number };

export function parseGithubTreeUrl(url: string): { owner: string; repo: string; ref: string; path: string } | null {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/(?:tree|blob)\/([^/]+)\/(.+?)\/?$/.exec(url);
  if (!match) return null;
  const path = (match[4] as string).replace(/\/SKILL\.md$/i, "");
  return { owner: match[1] as string, repo: match[2] as string, ref: match[3] as string, path };
}

async function fetchGithubFolder(fetchImpl: FetchLike, env: Record<string, string | undefined>, location: { owner: string; repo: string; ref: string; path: string }): Promise<HubFile[]> {
  const raw = (path: string) => `https://raw.githubusercontent.com/${location.owner}/${location.repo}/${encodeURIComponent(location.ref)}/${path.split("/").map(encodeURIComponent).join("/")}`;
  const listing = await getJson(fetchImpl, `https://api.github.com/repos/${location.owner}/${location.repo}/contents/${location.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(location.ref)}`, githubHeaders(env));
  const files: HubFile[] = [];
  if (listing.status === 200 && Array.isArray(listing.body)) {
    const entries = (listing.body as Array<{ type: string; path: string; size?: number }>)
      .filter((entry) => entry.type === "file" && TEXT_FILE.test(entry.path) && (entry.size ?? 0) <= MAX_FILE_BYTES)
      .slice(0, MAX_SKILL_FILES);
    for (const entry of entries) {
      const content = await getText(fetchImpl, raw(entry.path));
      if (content !== null) files.push({ path: entry.path.slice(location.path.length + 1), content });
    }
    return files;
  }
  // Rate limited or unlisted: SKILL.md alone, straight from raw.
  const skillMd = await getText(fetchImpl, raw(`${location.path}/SKILL.md`));
  return skillMd === null ? [] : [{ path: "SKILL.md", content: skillMd }];
}

export async function fetchSkillsMpSource(source: HubSourceConfig, fetchImpl: FetchLike = fetch, env: Record<string, string | undefined> = process.env): Promise<FetchedHubSkill[]> {
  const queries = Array.isArray(source.config.queries) ? source.config.queries.map(String) : ["agent"];
  const key = env.SKILLSMP_API_KEY?.trim();
  const byId = new Map<string, SkillsMpItem>();
  for (const query of queries) {
    const result = await getJson(fetchImpl, `https://skillsmp.com/api/v1/skills/search?q=${encodeURIComponent(query)}&limit=${Math.min(100, source.maxSkills)}&sort_by=stars`, key ? { authorization: `Bearer ${key}` } : {});
    if (result.status !== 200) {
      if (byId.size === 0 && query === queries[queries.length - 1]) throw new HubFetchError(`SkillsMP returned ${result.status}${result.status === 429 ? " (daily limit; set SKILLSMP_API_KEY)" : ""}.`);
      continue;
    }
    for (const item of ((result.body as { data?: { skills?: SkillsMpItem[] } }).data?.skills ?? [])) {
      if (item.githubUrl && !byId.has(item.id)) byId.set(item.id, item);
    }
  }
  const items = [...byId.values()].sort((left, right) => (right.stars ?? 0) - (left.stars ?? 0)).slice(0, source.maxSkills);

  const skills = await mapLimit(items, 3, async (item, index): Promise<FetchedHubSkill | null> => {
    const location = item.githubUrl ? parseGithubTreeUrl(item.githubUrl) : null;
    if (!location) return null;
    const files = await fetchGithubFolder(fetchImpl, env, location);
    if (!files.some((file) => file.path === "SKILL.md")) return null;
    const baseName = location.path.split("/").at(-1) ?? item.name;
    const { front, name } = describe(files, item.name);
    return {
      externalId: item.id,
      canonicalKey: canonicalGithubKey(location.owner, location.repo, baseName),
      slug: baseName,
      name,
      description: item.description ?? front.description,
      publisher: item.author ?? location.owner,
      sourceUrl: item.githubUrl ?? item.skillUrl ?? null,
      repository: `${location.owner}/${location.repo}`,
      path: location.path,
      version: front.version,
      license: front.license,
      popularity: { stars: item.stars ?? 0 },
      rank: index + 1,
      tags: [],
      upstreamSecurity: null,
      files: capFiles(files),
    };
  });
  return skills.filter((skill): skill is FetchedHubSkill => skill !== null);
}
