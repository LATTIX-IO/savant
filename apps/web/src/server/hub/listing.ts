import {
  canonicalGithubKey,
  capFiles,
  describe,
  fetchGithubFolder,
  getJson,
  getText,
  githubHeaders,
  HubFetchError,
  mapLimit,
  MAX_FILE_BYTES,
  MAX_SKILL_FILES,
  parseGithubTreeUrl,
  TEXT_FILE,
  type FetchedHubSkill,
  type FetchLike,
  type HubFile,
  type HubSourceConfig,
} from "./fetchers.ts";

/**
 * Full enumeration of a hub, in two steps:
 *
 *   list    — page through every listing (cheap metadata: name, description,
 *             popularity, and a locator for fetching it later)
 *   hydrate — fetch one listing's package files on demand
 *
 * Listing everything is cheap, so the catalog enumerates each hub completely.
 * Hydration, safety scans and live evaluations then work through the backlog
 * in popularity order under daily budgets.
 */

export type HubListing = {
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
  popularityScore: number;
  tags: string[];
  locator: Record<string, unknown>;
};

export type ListPage = {
  listings: HubListing[];
  /** Null when the source is fully enumerated. */
  nextCursor: string | null;
  total?: number | null;
  /** The source's API quota ran out; resume from the same cursor later. */
  quotaExhausted?: boolean;
};

export type ListingDeps = {
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
  skillsShToken?: () => Promise<string>;
};

const score = (popularity: Record<string, number>) => popularity.installs || popularity.downloads || popularity.stars || 0;

// ── GitHub repositories: the whole tree in one page ─────────────────────

async function listGithub(source: HubSourceConfig, deps: Required<Pick<ListingDeps, "fetchImpl" | "env">>): Promise<ListPage> {
  const owner = String(source.config.owner ?? "");
  const repo = String(source.config.repo ?? "");
  const roots = Array.isArray(source.config.roots) ? source.config.roots.map(String) : [""];
  if (!owner || !repo) throw new HubFetchError(`Source ${source.id} is missing owner/repo.`);
  const meta = await getJson(deps.fetchImpl, `https://api.github.com/repos/${owner}/${repo}`, githubHeaders(deps.env));
  if (meta.status !== 200) throw new HubFetchError(`GitHub returned ${meta.status} for ${owner}/${repo}${meta.status === 403 ? " (rate limited; set GITHUB_PUBLIC_TOKEN)" : ""}.`);
  const info = meta.body as { default_branch?: string; stargazers_count?: number; license?: { spdx_id?: string } | null };
  const branch = String(source.config.ref ?? info.default_branch ?? "main");
  const tree = await getJson(deps.fetchImpl, `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, githubHeaders(deps.env), 30_000);
  if (tree.status !== 200) throw new HubFetchError(`GitHub tree returned ${tree.status} for ${owner}/${repo}.`);
  const body = tree.body as { sha?: string; tree?: Array<{ path: string; type: string; size?: number }> };
  const blobs = (body.tree ?? []).filter((entry) => entry.type === "blob");
  const inRoots = (path: string) => roots.some((root) => root === "" || path === root || path.startsWith(`${root}/`));
  const dirs = blobs.filter((entry) => entry.path.endsWith("/SKILL.md") && inRoots(entry.path)).map((entry) => entry.path.slice(0, -"/SKILL.md".length)).sort();
  const repoLicense = info.license?.spdx_id && info.license.spdx_id !== "NOASSERTION" ? info.license.spdx_id : null;
  const stars = info.stargazers_count ?? 0;

  return {
    nextCursor: null,
    total: dirs.length,
    listings: dirs.slice(0, source.maxSkills).map((dir, index) => {
      const baseName = dir.split("/").at(-1) ?? dir;
      const entries = blobs.filter((entry) => entry.path.startsWith(`${dir}/`) && TEXT_FILE.test(entry.path) && (entry.size ?? 0) <= MAX_FILE_BYTES)
        .slice(0, MAX_SKILL_FILES).map((entry) => ({ path: entry.path, size: entry.size ?? 0 }));
      return {
        externalId: dir,
        canonicalKey: canonicalGithubKey(owner, repo, baseName),
        slug: baseName,
        name: baseName,
        description: null,
        publisher: source.publisher,
        sourceUrl: `https://github.com/${owner}/${repo}/tree/${branch}/${dir}`,
        repository: `${owner}/${repo}`,
        path: dir,
        version: body.sha?.slice(0, 12) ?? null,
        license: repoLicense,
        popularity: { stars },
        // Keep the repository's own ordering among equally starred skills.
        popularityScore: stars - index / 10_000,
        tags: dir.split("/").slice(0, -1).filter((part) => part && !part.startsWith(".") && !roots.includes(part)),
        locator: { kind: "github", owner, repo, branch, dir, entries },
      };
    }),
  };
}

async function hydrateGithub(listing: HubListing, deps: Required<Pick<ListingDeps, "fetchImpl" | "env">>): Promise<FetchedHubSkill | null> {
  const locator = listing.locator as { owner: string; repo: string; branch: string; dir: string; entries: Array<{ path: string }> };
  const prefix = `${locator.dir}/`;
  const files = (await mapLimit(locator.entries ?? [], 6, async (entry) => {
    const content = await getText(deps.fetchImpl, `https://raw.githubusercontent.com/${locator.owner}/${locator.repo}/${encodeURIComponent(locator.branch)}/${entry.path.split("/").map(encodeURIComponent).join("/")}`);
    return content === null ? null : { path: entry.path.slice(prefix.length), content };
  })).filter((file): file is HubFile => file !== null);
  return finish(listing, files, null);
}

// ── skills.sh: paginated leaderboard (v1, Vercel OIDC) ──────────────────

async function listSkillsSh(source: HubSourceConfig, cursor: string | null, deps: ListingDeps & { fetchImpl: FetchLike }): Promise<ListPage> {
  if (!deps.skillsShToken) throw new HubFetchError("skills.sh needs a Vercel OIDC token.");
  const page = Number(cursor ?? 0) || 0;
  const perPage = 500;
  const view = String(source.config.view ?? "all-time");
  const result = await getJson(deps.fetchImpl, `https://skills.sh/api/v1/skills?view=${encodeURIComponent(view)}&per_page=${perPage}&page=${page}`, { authorization: `Bearer ${await deps.skillsShToken()}` }, 30_000);
  if (result.status === 429) return { listings: [], nextCursor: String(page), quotaExhausted: true };
  if (result.status !== 200) throw new HubFetchError(`skills.sh returned ${result.status}.`);
  const body = result.body as { data?: Array<{ id: string; slug: string; name?: string; source: string; installs?: number; sourceType?: string; url?: string }>; pagination?: { hasMore?: boolean; total?: number } };
  const listings = (body.data ?? []).map((entry): HubListing => {
    const [owner, repo] = entry.source.split("/");
    const popularity = { installs: entry.installs ?? 0 };
    return {
      externalId: entry.id,
      canonicalKey: entry.sourceType === "github" && owner && repo ? canonicalGithubKey(owner, repo, entry.slug) : `skills.sh:${entry.id}`,
      slug: entry.slug,
      name: entry.name ?? entry.slug,
      description: null,
      publisher: owner ?? entry.source,
      sourceUrl: entry.url ?? `https://skills.sh/${entry.id}`,
      repository: entry.sourceType === "github" ? entry.source : null,
      path: null,
      version: null,
      license: null,
      popularity,
      popularityScore: score(popularity),
      tags: [],
      locator: { kind: "skills_sh", source: entry.source, slug: entry.slug },
    };
  });
  return { listings, nextCursor: body.pagination?.hasMore ? String(page + 1) : null, total: body.pagination?.total ?? null };
}

async function hydrateSkillsSh(listing: HubListing, deps: ListingDeps & { fetchImpl: FetchLike }): Promise<FetchedHubSkill | null> {
  if (!deps.skillsShToken) throw new HubFetchError("skills.sh needs a Vercel OIDC token.");
  const locator = listing.locator as { source: string; slug: string };
  const auth = { authorization: `Bearer ${await deps.skillsShToken()}` };
  const path = `${locator.source.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(locator.slug)}`;
  const detail = await getJson(deps.fetchImpl, `https://skills.sh/api/v1/skills/${path}`, auth);
  if (detail.status !== 200) return null;
  const body = detail.body as { hash?: string; files?: Array<{ path: string; contents?: string }> };
  const files = (body.files ?? []).filter((file) => typeof file.contents === "string" && TEXT_FILE.test(file.path))
    .map((file) => ({ path: file.path.replace(/^\.?\//, ""), content: file.contents as string }));
  const audit = await getJson(deps.fetchImpl, `https://skills.sh/api/v1/skills/audit/${path}`, auth).catch(() => null);
  return finish({ ...listing, version: body.hash?.slice(0, 12) ?? listing.version }, files, audit && audit.status === 200 ? audit.body : null);
}

// ── ClawHub: cursor pagination, non-suspicious only ─────────────────────

async function listClawHub(source: HubSourceConfig, cursor: string | null, deps: { fetchImpl: FetchLike }): Promise<ListPage> {
  const sort = String(source.config.sort ?? "downloads");
  const result = await getJson(deps.fetchImpl, `https://clawhub.ai/api/v1/skills?limit=200&sort=${encodeURIComponent(sort)}&nonSuspiciousOnly=true${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, {}, 30_000);
  if (result.status === 429) return { listings: [], nextCursor: cursor ?? "", quotaExhausted: true };
  if (result.status !== 200) throw new HubFetchError(`ClawHub returned ${result.status}.`);
  const body = result.body as { items?: Array<{ ownerHandle: string; slug: string; displayName?: string; summary?: string | null; topics?: string[]; stats?: Record<string, number>; latestVersion?: { version?: string; license?: string | null } | null }>; nextCursor?: string | null };
  const listings = (body.items ?? []).filter((item) => item.latestVersion?.version).map((item): HubListing => {
    const popularity = { downloads: item.stats?.downloads ?? 0, installs: item.stats?.installs ?? 0, stars: item.stats?.stars ?? 0 };
    return {
      externalId: `${item.ownerHandle}/${item.slug}`,
      canonicalKey: `clawhub:${item.ownerHandle.toLowerCase()}/${item.slug.toLowerCase()}`,
      slug: item.slug,
      name: item.displayName ?? item.slug,
      description: item.summary ?? null,
      publisher: item.ownerHandle,
      sourceUrl: `https://clawhub.ai/${item.ownerHandle}/skills/${item.slug}`,
      repository: null,
      path: null,
      version: item.latestVersion?.version ?? null,
      license: item.latestVersion?.license ?? null,
      popularity,
      popularityScore: popularity.downloads || popularity.installs || popularity.stars,
      tags: item.topics ?? [],
      locator: { kind: "clawhub", owner: item.ownerHandle, slug: item.slug, version: item.latestVersion?.version },
    };
  });
  return { listings, nextCursor: body.nextCursor ?? null };
}

async function hydrateClawHub(listing: HubListing, deps: { fetchImpl: FetchLike }): Promise<FetchedHubSkill | null> {
  const locator = listing.locator as { owner: string; slug: string; version: string };
  const owner = encodeURIComponent(locator.owner);
  const detail = await getJson(deps.fetchImpl, `https://clawhub.ai/api/v1/skills/${encodeURIComponent(locator.slug)}/versions/${encodeURIComponent(locator.version)}?owner=${owner}`);
  if (detail.status !== 200) return null;
  const version = (detail.body as { version?: { files?: Array<{ path: string; size?: number }>; security?: unknown } }).version ?? {};
  const entries = (version.files ?? []).filter((file) => TEXT_FILE.test(file.path) && (file.size ?? 0) <= MAX_FILE_BYTES).slice(0, MAX_SKILL_FILES);
  const files = (await mapLimit(entries, 4, async (file) => {
    const content = await getText(deps.fetchImpl, `https://clawhub.ai/api/v1/skills/${encodeURIComponent(locator.slug)}/file?path=${encodeURIComponent(file.path)}&version=${encodeURIComponent(locator.version)}&owner=${owner}`);
    return content === null ? null : { path: file.path.replace(/^\.?\//, ""), content };
  })).filter((file): file is HubFile => file !== null);
  return finish(listing, files, version.security ?? null);
}

// ── SkillsMP: search pages per configured query, bounded by its API quota ─

async function listSkillsMp(source: HubSourceConfig, cursor: string | null, deps: Required<Pick<ListingDeps, "fetchImpl" | "env">>): Promise<ListPage> {
  const queries = Array.isArray(source.config.queries) ? source.config.queries.map(String) : ["agent"];
  const state = (cursor ? JSON.parse(cursor) : { q: 0, page: 1 }) as { q: number; page: number };
  if (state.q >= queries.length) return { listings: [], nextCursor: null };
  const key = deps.env.SKILLSMP_API_KEY?.trim();
  const result = await getJson(deps.fetchImpl, `https://skillsmp.com/api/v1/skills/search?q=${encodeURIComponent(queries[state.q] as string)}&limit=50&page=${state.page}&sort_by=stars`, key ? { authorization: `Bearer ${key}` } : {});
  if (result.status === 429) return { listings: [], nextCursor: JSON.stringify(state), quotaExhausted: true };
  if (result.status !== 200) throw new HubFetchError(`SkillsMP returned ${result.status}.`);
  const items = ((result.body as { data?: { skills?: Array<{ id: string; name: string; author?: string; description?: string; githubUrl?: string; stars?: number }> } }).data?.skills ?? []);
  const listings = items.flatMap((item): HubListing[] => {
    const location = item.githubUrl ? parseGithubTreeUrl(item.githubUrl) : null;
    if (!location) return [];
    const baseName = location.path.split("/").at(-1) ?? item.name;
    const popularity = { stars: item.stars ?? 0 };
    return [{
      externalId: item.id,
      canonicalKey: canonicalGithubKey(location.owner, location.repo, baseName),
      slug: baseName,
      name: item.name,
      description: item.description ?? null,
      publisher: item.author ?? location.owner,
      sourceUrl: item.githubUrl ?? null,
      repository: `${location.owner}/${location.repo}`,
      path: location.path,
      version: null,
      license: null,
      popularity,
      popularityScore: popularity.stars,
      tags: [],
      locator: { kind: "skillsmp", ...location },
    }];
  });
  const next = items.length < 50 ? { q: state.q + 1, page: 1 } : { q: state.q, page: state.page + 1 };
  return { listings, nextCursor: next.q >= queries.length ? null : JSON.stringify(next) };
}

async function hydrateSkillsMp(listing: HubListing, deps: Required<Pick<ListingDeps, "fetchImpl" | "env">>): Promise<FetchedHubSkill | null> {
  const locator = listing.locator as { owner: string; repo: string; ref: string; path: string };
  return finish(listing, await fetchGithubFolder(deps.fetchImpl, deps.env, locator), null);
}

// ── Shared ──────────────────────────────────────────────────────────────

function finish(listing: HubListing, files: HubFile[], upstreamSecurity: unknown): FetchedHubSkill | null {
  if (!files.some((file) => file.path === "SKILL.md")) return null;
  const { front, name } = describe(files, listing.name);
  return {
    externalId: listing.externalId,
    canonicalKey: listing.canonicalKey,
    slug: listing.slug,
    name: listing.locator.kind === "clawhub" || listing.locator.kind === "skillsmp" ? listing.name : name,
    description: listing.description ?? front.description,
    publisher: listing.publisher,
    sourceUrl: listing.sourceUrl,
    repository: listing.repository,
    path: listing.path,
    version: front.version ?? listing.version,
    license: front.license ?? listing.license ?? (files.some((file) => /^LICENSE/i.test(file.path)) ? "See LICENSE" : null),
    popularity: listing.popularity,
    rank: 0,
    tags: listing.tags,
    upstreamSecurity,
    files: capFiles(files),
  };
}

export class HubTransientError extends HubFetchError {}

/** Retries transient upstream failures (5xx, 508 loop/limit pages, network errors) with backoff. */
function retrying(fetchImpl: FetchLike): FetchLike {
  return async (input, init) => {
    let last: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchImpl(input, init);
        if (response.status < 500) return response;
        last = response;
      } catch (error) {
        if (attempt === 2) throw new HubTransientError(`Network error: ${error instanceof Error ? error.message : String(error)}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
    }
    return last as Response;
  };
}

export async function listSourcePage(source: HubSourceConfig, cursor: string | null, deps: ListingDeps = {}): Promise<ListPage> {
  const resolved = { ...deps, fetchImpl: retrying(deps.fetchImpl ?? fetch), env: deps.env ?? process.env };
  switch (source.kind) {
    case "github": return cursor ? { listings: [], nextCursor: null } : listGithub(source, resolved);
    case "skills_sh": return listSkillsSh(source, cursor, resolved);
    case "clawhub": return listClawHub(source, cursor, resolved);
    case "skillsmp": return listSkillsMp(source, cursor, resolved);
  }
}

export async function hydrateListing(listing: HubListing, deps: ListingDeps = {}): Promise<FetchedHubSkill | null> {
  const resolved = { ...deps, fetchImpl: deps.fetchImpl ?? fetch, env: deps.env ?? process.env };
  switch (listing.locator.kind) {
    case "github": return hydrateGithub(listing, resolved);
    case "skills_sh": return hydrateSkillsSh(listing, resolved);
    case "clawhub": return hydrateClawHub(listing, resolved);
    case "skillsmp": return hydrateSkillsMp(listing, resolved);
    default: return null;
  }
}
