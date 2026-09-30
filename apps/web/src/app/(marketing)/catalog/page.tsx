import type { Route } from "next";
import Link from "next/link";

import { TRUST_LABEL, VERDICT_LABEL, popularityLabel } from "@/components/catalog/catalog-labels";
import { SiteFrame } from "@/components/marketing/site-frame";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { buildPublicPageMetadata } from "@/lib/seo-metadata";
import { catalogStats, listCatalog, listCatalogSources, type CatalogSkillSummary, type CatalogSource } from "@/server/hub/catalog-read";

import "./catalog.css";

export const metadata = buildPublicPageMetadata("/catalog");
export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

async function loadCatalog(params: { q: string; source: string; verdict: string; page: number }) {
  try {
    const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
    const sql = getControlPlaneDatabase();
    const [list, sources, stats] = await Promise.all([
      listCatalog(sql, { q: params.q, source: params.source, verdict: params.verdict, limit: PAGE_SIZE, offset: (params.page - 1) * PAGE_SIZE }),
      listCatalogSources(sql),
      catalogStats(sql),
    ]);
    return { ...list, sources, stats, error: null as string | null };
  } catch {
    return { items: [] as CatalogSkillSummary[], total: 0, sources: [] as CatalogSource[], stats: null, error: "The catalog is temporarily unavailable." };
  }
}

function query(params: Record<string, string | number>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== "" && value !== 1) search.set(key, String(value));
  const text = search.toString();
  return (text ? `/catalog?${text}` : "/catalog") as Route;
}

export default async function CatalogPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = await searchParams;
  const params = { q: first(raw.q).slice(0, 100), source: first(raw.source), verdict: first(raw.verdict), page: Math.max(1, Number(first(raw.page)) || 1) };
  const session = auth0 ? await auth0.getSession() : null;
  const viewer = buildAuthViewer(session?.user);
  const data = await loadCatalog(params);
  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));

  return (
    <SiteFrame signedIn={viewer.isAuthenticated} current="catalog">
      <section className="page-hero" aria-labelledby="catalog-title">
        <div className="shell">
          <div className="sh-meta">
            <span className="sh-index">Catalog</span>
            <span className="sh-label">Public skills, independently analyzed</span>
          </div>
          <h1 id="catalog-title" className="display-1">
            Skills worth <em>trusting</em>.
          </h1>
          <p className="page-lede">
            Agent skills from Anthropic, OpenAI, skills.sh, ClawHub, SkillsMP and other reputable sources. Savant scans each one with
            NVIDIA SkillSpector and evaluates it live, with an LLM drafting and running test cases and Jev validating and scoring them.
            Workspaces import any skill into their own repositories through a reviewed pull request.
          </p>
          {data.stats && (
            <div className="cat-stats">
              <div><strong>{data.stats.skills}</strong>skills cataloged</div>
              <div><strong>{data.stats.scanned}</strong>safety-scanned</div>
              <div><strong>{data.stats.evaluated}</strong>evaluated live</div>
              <div><strong>{data.stats.validated}</strong>validated</div>
              <div><strong>{data.stats.flagged}</strong>flagged for review</div>
            </div>
          )}
        </div>
      </section>

      <section className="section page-body" aria-label="Skill catalog">
        <div className="shell">
          {data.sources.length > 0 && (
            <div className="cat-sources">
              {data.sources.map((source) => (
                <Link key={source.id} href={query({ source: source.id })}>
                  <div className="cat-panel">
                    <div className="cat-meta" style={{ marginBottom: 6 }}>
                      <span className="cat-badge" data-trust={source.trust}>{TRUST_LABEL[source.trust]}</span>
                      <span>{source.skillCount} skills</span>
                    </div>
                    <strong style={{ fontSize: 14.5 }}>{source.name}</strong>
                    <div className="cat-meta">{source.publisher}</div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          <form className="cat-toolbar" action="/catalog" method="get" role="search">
            <input type="search" name="q" defaultValue={params.q} placeholder="Search skills, publishers, topics…" aria-label="Search skills" />
            <select name="source" defaultValue={params.source} aria-label="Source">
              <option value="">All sources</option>
              {data.sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
            <select name="verdict" defaultValue={params.verdict} aria-label="Savant verdict">
              <option value="">Any verdict</option>
              {Object.entries(VERDICT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <button type="submit" className="btn btn-primary btn-sm">Search</button>
          </form>

          {data.error && <p className="cat-empty">{data.error}</p>}
          {!data.error && data.items.length === 0 && <p className="cat-empty">No skills match. The catalog refreshes from its sources daily.</p>}

          <div className="cat-grid">
            {data.items.map((skill) => (
              <Link key={skill.id} href={`/catalog/${skill.id}` as Route} className="cat-card">
                <div className="cat-meta">
                  <span className="cat-badge" data-verdict={skill.verdict}>{VERDICT_LABEL[skill.verdict]}</span>
                  {skill.evalScore !== null && <span>Live eval {Math.round(skill.evalScore)}/100</span>}
                  {skill.riskScore !== null && <span>Risk {skill.riskScore}/100</span>}
                </div>
                <h3>{skill.name}</h3>
                {skill.description && <p>{skill.description}</p>}
                <div className="cat-meta" style={{ marginTop: "auto" }}>
                  <span className="cat-badge" data-trust={skill.trust}>{skill.sourceName}</span>
                  {skill.publisher && <span>{skill.publisher}</span>}
                  {popularityLabel(skill.popularity) && <span>{popularityLabel(skill.popularity)}</span>}
                  {skill.alsoOn.length > 0 && <span>also on {skill.alsoOn.slice(0, 2).join(", ")}</span>}
                </div>
              </Link>
            ))}
          </div>

          {pages > 1 && (
            <nav className="cat-pager" aria-label="Pages">
              {params.page > 1 && <Link className="btn btn-quiet btn-sm" href={query({ q: params.q, source: params.source, verdict: params.verdict, page: params.page - 1 })}>Previous</Link>}
              <span className="cat-meta">Page {params.page} of {pages}</span>
              {params.page < pages && <Link className="btn btn-quiet btn-sm" href={query({ q: params.q, source: params.source, verdict: params.verdict, page: params.page + 1 })}>Next</Link>}
            </nav>
          )}
        </div>
      </section>
    </SiteFrame>
  );
}
