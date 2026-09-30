"use client";

import type { ChangeProposal, RepositoryListItem } from "@savant/types";
import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { TRUST_LABEL, VERDICT_HINT, VERDICT_LABEL, popularityLabel } from "@/components/catalog/catalog-labels";
import { fetchRepositoryList } from "@/lib/control-plane-client";
import {
  fetchCatalog,
  fetchCatalogSkill,
  importCatalogSkill,
  requestCatalogAnalysis,
  type CatalogListResponse,
} from "@/lib/git-connections-client";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import type { CatalogSkillDetail } from "@/server/hub/catalog-read";

import { SkillProposalNotice } from "./skill-assessment-findings";

const VERDICT_CHIP: Record<string, string> = {
  validated: "chip-moss",
  analyzed: "chip-paper",
  caution: "chip-brass",
  unsafe: "chip-blood",
  unverified: "chip-paper",
};

const PAGE = 60;

/** Workspace view of the public skill catalog: browse, analyze and import. */
export function SkillHubScreen() {
  const pathname = usePathname() || "/";
  const [filters, setFilters] = useState({ q: "", source: "", verdict: "" });
  const [draft, setDraft] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<CatalogListResponse["data"] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchCatalog({ ...filters, limit: PAGE, offset })
      .then((response) => {
        if (active) {
          setData(response.data);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The catalog is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [filters, offset]);

  return (
    <div className="page-inner">
      <div className="page-head">
        <div>
          <div className="page-head-meta">
            <span>/04</span>
            <span className="sep">—</span>
            <span>Skill catalog</span>
          </div>
          <h1 className="h-display">Skill catalog</h1>
          <div className="page-head-sub">
            Skills from Anthropic, OpenAI, skills.sh, ClawHub, SkillsMP and other sources, safety-scanned with NVIDIA SkillSpector and
            evaluated live (LLM-drafted cases, Jev-validated and scored). Import any skill into a connected repository as a reviewed pull request.
          </div>
        </div>
        <a className="btn btn-ghost" href="/catalog" target="_blank" rel="noopener noreferrer">Public catalog</a>
      </div>

      {data && (
        <div className="row" style={{ gap: 24, flexWrap: "wrap", marginBottom: 16, fontSize: 12.5 }}>
          <span><strong>{data.stats.skills}</strong> cataloged</span>
          <span><strong>{data.stats.scanned}</strong> safety-scanned</span>
          <span><strong>{data.stats.evaluated}</strong> evaluated live</span>
          <span><strong>{data.stats.validated}</strong> validated</span>
          <span><strong>{data.stats.flagged}</strong> flagged</span>
        </div>
      )}

      <form
        className="row"
        style={{ gap: 8, flexWrap: "wrap", marginBottom: 16 }}
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setFilters((current) => ({ ...current, q: draft.trim() }));
        }}
      >
        <input className="input" style={{ flex: "1 1 260px", minWidth: 0 }} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Search skills, publishers, topics…" aria-label="Search the catalog" />
        <select className="input" value={filters.source} onChange={(event) => { setOffset(0); setFilters((current) => ({ ...current, source: event.target.value })); }} aria-label="Source">
          <option value="">All sources</option>
          {data?.sources.map((source) => <option key={source.id} value={source.id}>{source.name} ({source.skillCount})</option>)}
        </select>
        <select className="input" value={filters.verdict} onChange={(event) => { setOffset(0); setFilters((current) => ({ ...current, verdict: event.target.value })); }} aria-label="Verdict">
          <option value="">Any verdict</option>
          {Object.entries(VERDICT_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <button type="submit" className="btn btn-primary">Search</button>
      </form>

      {error && <div className="note blood"><span style={{ fontSize: 12.5 }}>{error}</span></div>}

      <div className="panel">
        <div className="panel-bd tight" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Skill</th>
                <th style={{ width: 170 }}>Source</th>
                <th style={{ width: 130 }}>Verdict</th>
                <th style={{ width: 90, textAlign: "right" }}>Live eval</th>
                <th style={{ width: 80, textAlign: "right" }}>Risk</th>
              </tr>
            </thead>
            <tbody>
              {!data && !error && <tr><td colSpan={5} className="subtle">Loading…</td></tr>}
              {data?.items.length === 0 && <tr><td colSpan={5} className="subtle">No skills match.</td></tr>}
              {data?.items.map((skill) => (
                <tr key={skill.id}>
                  <td>
                    <Link href={buildTenantAwareAppPath(pathname, `/catalog/${skill.id}`) as Route} style={{ fontWeight: 600 }}>{skill.name}</Link>
                    {skill.description && <div className="subtle" style={{ fontSize: 12, maxWidth: 560, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{skill.description}</div>}
                  </td>
                  <td>
                    <div style={{ fontSize: 12.5 }}>{skill.sourceName}</div>
                    <div className="subtle" style={{ fontSize: 11 }}>{TRUST_LABEL[skill.trust]}{popularityLabel(skill.popularity) ? ` · ${popularityLabel(skill.popularity)}` : ""}</div>
                  </td>
                  <td><span className={`chip ${VERDICT_CHIP[skill.verdict] ?? "chip-paper"}`}>{VERDICT_LABEL[skill.verdict]}</span></td>
                  <td style={{ textAlign: "right" }} className="mono">{skill.evalScore !== null ? Math.round(skill.evalScore) : skill.evalStatus === "running" || skill.evalStatus === "queued" ? "…" : "—"}</td>
                  <td style={{ textAlign: "right" }} className="mono">{skill.riskScore ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.total > PAGE && (
        <div className="row" style={{ gap: 8, justifyContent: "center", marginTop: 12 }}>
          <button type="button" className="btn btn-ghost btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <span className="subtle" style={{ fontSize: 12 }}>{offset + 1}–{Math.min(offset + PAGE, data.total)} of {data.total}</span>
          <button type="button" className="btn btn-ghost btn-sm" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      )}
    </div>
  );
}

export function SkillHubSkillScreen({ id }: { id: string }) {
  const pathname = usePathname() || "/";
  const [skill, setSkill] = useState<CatalogSkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [repositories, setRepositories] = useState<RepositoryListItem[]>([]);
  const [repositoryId, setRepositoryId] = useState("");
  const [targetRoot, setTargetRoot] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState<"analyze" | "import" | null>(null);
  const [message, setMessage] = useState<{ tone: "default" | "error"; text: string } | null>(null);
  const [proposal, setProposal] = useState<ChangeProposal | null>(null);

  useEffect(() => {
    let active = true;
    fetchCatalogSkill(id)
      .then((response) => {
        if (!active) return;
        setSkill(response.data);
        setTargetRoot((current) => current || `tier2/imported/${response.data.sourceId}/${response.data.slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "The skill is unavailable.");
      });
    return () => {
      active = false;
    };
  }, [id, refresh]);

  useEffect(() => {
    let active = true;
    fetchRepositoryList().then((response) => {
      if (!active) return;
      setRepositories(response.data);
      setRepositoryId((current) => current || response.data[0]?.id || "");
    }).catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const evaluating = skill?.evalStatus === "queued" || skill?.evalStatus === "running";
  useEffect(() => {
    if (!evaluating) return;
    const timer = setTimeout(() => setRefresh((value) => value + 1), 6000);
    return () => clearTimeout(timer);
  }, [evaluating, skill]);

  async function analyze() {
    setBusy("analyze");
    setMessage(null);
    try {
      await requestCatalogAnalysis(id);
      setMessage({ tone: "default", text: "Live analysis started. Results appear here in a few minutes." });
      setRefresh((value) => value + 1);
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "Analysis could not be started." });
    } finally {
      setBusy(null);
    }
  }

  async function importSkill() {
    if (!repositoryId) return;
    setBusy("import");
    setMessage(null);
    try {
      const response = await importCatalogSkill(id, { repositoryId, targetRoot, ...(owner.trim() ? { owner: owner.trim() } : {}) });
      setProposal(response.data.proposal);
      setMessage({ tone: "default", text: `Proposed ${response.data.proposal.files.length} file${response.data.proposal.files.length === 1 ? "" : "s"} under ${response.data.root}. Approve to open a pull request.` });
    } catch (reason) {
      setMessage({ tone: "error", text: reason instanceof Error ? reason.message : "The import could not be proposed." });
    } finally {
      setBusy(null);
    }
  }

  if (error) {
    return <div className="page-inner"><div className="note blood"><span>{error}</span></div></div>;
  }
  if (!skill) {
    return <div className="page-inner"><span className="subtle">Loading…</span></div>;
  }
  const scorecard = skill.evaluation?.scorecard;

  return (
    <div className="page-inner">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="page-head-meta">
            <Link href={buildTenantAwareAppPath(pathname, "/catalog") as Route}>Skill catalog</Link>
            <span className="sep">—</span>
            <span>{skill.sourceName}</span>
          </div>
          <h1 className="h-display" style={{ overflowWrap: "anywhere" }}>{skill.name}</h1>
          {skill.description && <div className="page-head-sub">{skill.description}</div>}
          <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <span className={`chip ${VERDICT_CHIP[skill.verdict] ?? "chip-paper"}`}>{VERDICT_LABEL[skill.verdict]}</span>
            <span className="chip chip-paper">{TRUST_LABEL[skill.trust]}</span>
            {skill.license && <span className="chip chip-paper">{skill.license}</span>}
            {popularityLabel(skill.popularity) && <span className="subtle" style={{ fontSize: 12 }}>{popularityLabel(skill.popularity)}</span>}
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {skill.sourceUrl && <a className="btn btn-ghost" href={skill.sourceUrl} target="_blank" rel="noopener noreferrer">Source</a>}
          <button type="button" className="btn btn-ghost" disabled={busy !== null || evaluating} onClick={() => void analyze()}>
            {evaluating ? "Evaluating…" : skill.evalStatus === "complete" || skill.evalStatus === "needs_review" ? "Re-run live analysis" : "Run live analysis"}
          </button>
        </div>
      </div>

      {message && <div className={`note ${message.tone === "error" ? "blood" : ""}`} style={{ marginBottom: 12 }}><span style={{ fontSize: 12.5 }}>{message.text}</span></div>}
      {proposal && <div style={{ marginBottom: 12 }}><SkillProposalNotice proposal={proposal} onUpdated={setProposal} /></div>}

      <div className="split wide">
        <div className="col" style={{ gap: "var(--gutter)", minWidth: 0 }}>
          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Verdict · {VERDICT_LABEL[skill.verdict]}</div></div>
            <div className="panel-bd"><span style={{ fontSize: 12.5 }}>{VERDICT_HINT[skill.verdict]}</span></div>
          </div>

          <div className="panel">
            <div className="panel-hd">
              <div className="panel-title">Live evaluation</div>
              <span className="subtle" style={{ fontSize: 11.5 }}>{skill.evaluation?.models?.generator ?? "NVIDIA NIM"} drafts and runs · {skill.evaluation?.models?.judge ?? "Jev"} validates and scores</span>
            </div>
            <div className="panel-bd col" style={{ gap: 10 }}>
              {scorecard?.overallScore !== undefined ? (
                <>
                  <div className="row" style={{ gap: 24, flexWrap: "wrap" }}>
                    {([["Overall", scorecard.overallScore], ["Quality", scorecard.qualityScore], ["Compliance", scorecard.complianceScore], ["Grounding", scorecard.groundingScore], ["Actionability", scorecard.actionabilityScore], ["Efficiency", scorecard.efficiencyScore]] as const).map(([label, value]) => (
                      <div key={label} className="col" style={{ gap: 2 }}>
                        <span className="subtle" style={{ fontSize: 10.5, textTransform: "uppercase" }}>{label}</span>
                        <span style={{ fontSize: 18, fontWeight: 600 }}>{value === undefined ? "—" : Math.round(value)}</span>
                      </div>
                    ))}
                  </div>
                  <span className="subtle" style={{ fontSize: 12 }}>
                    {scorecard.passCount ?? 0} pass · {scorecard.investigateCount ?? 0} investigate · {scorecard.failCount ?? 0} fail
                    {skill.evaluation?.metrics?.drafted ? ` · Jev accepted ${skill.evaluation.metrics.accepted ?? 0} of ${skill.evaluation.metrics.drafted} drafts` : ""}
                    {" · generated evaluations are included when you import"}
                  </span>
                </>
              ) : (
                <span className="subtle" style={{ fontSize: 12.5 }}>
                  {evaluating ? "Running: the LLM drafts cases, Jev validates them, the skill runs, and Jev scores the outputs." : skill.evalStatus === "failed" ? `Last run failed${skill.evalError ? `: ${skill.evalError}` : "."}` : "No live evaluation yet. Run one to get a starting baseline — this skill has no answer key."}
                </span>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Safety · NVIDIA SkillSpector</div></div>
            <div className="panel-bd col" style={{ gap: 6 }}>
              {skill.safety?.status === "complete" ? (
                <>
                  <span style={{ fontSize: 13 }}>{(skill.safety.recommendation ?? "unknown").replace(/_/g, " ").toLowerCase()} · risk {skill.safety.riskScore ?? "—"}/100</span>
                  {skill.safety.issues.slice(0, 10).map((issue, index) => (
                    <div key={`${issue.id}-${index}`} style={{ fontSize: 12.5 }}>
                      <span className="mono" style={{ fontSize: 10.5 }}>{issue.severity}</span> {issue.category}: {issue.title}
                      {issue.file && <span className="subtle mono" style={{ fontSize: 11 }}> {issue.file}{issue.line ? `:${issue.line}` : ""}</span>}
                    </div>
                  ))}
                </>
              ) : (
                <span className="subtle" style={{ fontSize: 12.5 }}>{skill.safety?.status === "unavailable" ? skill.safety.error ?? "Scanning unavailable." : "Scan pending."}</span>
              )}
            </div>
          </div>

          {skill.findings.length > 0 && (
            <div className="panel">
              <div className="panel-hd"><div className="panel-title">Structure · {skill.findings.length}</div></div>
              <div className="panel-bd col" style={{ gap: 8 }}>
                {skill.findings.map((finding) => (
                  <div key={finding.code} className="col" style={{ gap: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600 }}>{finding.title}</span>
                    <span className="subtle" style={{ fontSize: 12 }}>{finding.detail}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="panel">
            <div className="panel-hd"><div className="panel-title">SKILL.md</div><span className="subtle" style={{ fontSize: 11.5 }}>{skill.fileCount} files</span></div>
            <div className="panel-bd">
              <pre className="mono" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12, maxHeight: 520, overflow: "auto", margin: 0 }}>{skill.skillMd}</pre>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: "var(--gutter)" }}>
          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Import into a repository</div></div>
            <div className="panel-bd col" style={{ gap: 10 }}>
              {repositories.length === 0 ? (
                <span className="subtle" style={{ fontSize: 12.5 }}>Connect a repository first (Repositories → Connect).</span>
              ) : (
                <>
                  <label className="col" style={{ gap: 4, fontSize: 12 }}>
                    Repository
                    <select className="input" value={repositoryId} onChange={(event) => setRepositoryId(event.target.value)}>
                      {repositories.map((repository) => <option key={repository.id} value={repository.id}>{repository.name}</option>)}
                    </select>
                  </label>
                  <label className="col" style={{ gap: 4, fontSize: 12 }}>
                    Path
                    <input className="input mono" value={targetRoot} onChange={(event) => setTargetRoot(event.target.value)} />
                  </label>
                  <label className="col" style={{ gap: 4, fontSize: 12 }}>
                    Owner (optional)
                    <input className="input" value={owner} onChange={(event) => setOwner(event.target.value)} placeholder="e.g. platform-team" />
                  </label>
                  <button type="button" className="btn btn-primary" disabled={busy !== null || !repositoryId || skill.verdict === "unsafe"} onClick={() => void importSkill()}>
                    {busy === "import" ? "Preparing…" : "Propose import"}
                  </button>
                  <span className="subtle" style={{ fontSize: 11.5 }}>
                    Adds the package with contract metadata (provenance and Savant&apos;s analysis), an agent overlay, evaluations and a registry entry,
                    as a proposal. Approving it opens a pull request under your repository&apos;s review rules.
                    {skill.verdict === "unsafe" ? " Unsafe skills can't be imported." : ""}
                  </span>
                </>
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel-hd"><div className="panel-title">Details</div></div>
            <div className="panel-bd col" style={{ gap: 4, fontSize: 12.5 }}>
              <span>Source: {skill.sourceName}</span>
              {skill.publisher && <span>Publisher: {skill.publisher}</span>}
              {skill.repository && <span className="mono" style={{ fontSize: 11.5 }}>{skill.repository}{skill.path ? `/${skill.path}` : ""}</span>}
              <span>Version: {skill.version ?? "—"}</span>
              <span>License: {skill.license ?? "not declared"}</span>
              {skill.alsoOn.length > 0 && <span>Also on: {skill.alsoOn.join(", ")}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
