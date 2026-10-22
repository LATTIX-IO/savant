"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { RepositoryListItem, SkillDetailPayload, SkillListItem } from "@savant/types";

import { Ic } from "@/components/savant/icons";
import { useOnboarding } from "@/components/savant/onboarding-context";
import { SkillCreateModal } from "@/components/savant/skill-create-modal";
import {
  UiV2Button, UiV2EmptyState, UiV2InspectorDrawer, UiV2Metric, UiV2PageHeader,
  UiV2StateBanner, UiV2Status, UiV2TableViewport,
} from "@/components/savant/ui-v2";
import { useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { fetchRepositoryList, fetchSkillAssets, fetchSkillDetail, fetchSkillList } from "@/lib/control-plane-client";
import type { SkillAssetResponseData } from "@/lib/ui-v2-skill-assets";
import { buildSkillDetailPath } from "@/lib/skill-paths";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import {
  filterUiV2Repositories, filterUiV2Skills, getUiV2RepositoryHealth, nextUiV2LibrarySection,
  safeUiV2Count, uiV2ProvenanceNote, type LibrarySection, type LibraryStage,
} from "@/lib/ui-v2-library-model";
import styles from "./ui-v2-pages.module.css";

type SourceState<T> =
  | { scope: string; phase: "loading"; data: null; error: null }
  | { scope: string; phase: "ready"; data: readonly T[]; error: null }
  | { scope: string; phase: "error"; data: null; error: string };
const initialSkills: SourceState<SkillListItem> = { scope: "", phase: "loading", data: null, error: null };
const initialRepositories: SourceState<RepositoryListItem> = { scope: "", phase: "loading", data: null, error: null };

export function LibraryV2() {
  const scope = useUiV2WorkspaceSlug() ?? "";
  const pathname = usePathname() || "/";
  const { show, latestConnectedRepository } = useOnboarding();
  const [section, setSection] = useState<LibrarySection>("skills");
  const [term, setTerm] = useState("");
  const [stage, setStage] = useState<LibraryStage>("all");
  const [tierFilter, setTierFilter] = useState<"all" | 1 | 2 | 3>("all");
  const [repoFilter, setRepoFilter] = useState("");
  const [detailView, setDetailView] = useState(false);
  const [selected, setSelected] = useState<{ scope: string; skill: SkillListItem } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<"summary" | "versions" | "usage" | "dependencies">("summary");
  const [skillDetail, setSkillDetail] = useState<{ scope: string; id: string; data: SkillDetailPayload | null;
    loading: boolean; error: string | null }>({ scope: "", id: "", data: null, loading: false, error: null });
  const [assetInventory,setAssetInventory]=useState<{scope:string;id:string;
    state:"loading"|"ready"|"error";data:SkillAssetResponseData|null;error:string|null}>({
    scope:"",id:"",state:"loading",data:null,error:null,
  });
  const [skills, setSkills] = useState<SourceState<SkillListItem>>(initialSkills);
  const [repositories, setRepositories] = useState<SourceState<RepositoryListItem>>(initialRepositories);
  const [retry, setRetry] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const lastConnectedAt = latestConnectedRepository?.at ?? 0;

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) setSkills({ scope, phase: "loading", data: null, error: null }); });
    void fetchSkillList(undefined, { workspaceSlug: scope, signal: controller.signal })
      .then(response => {
        if (active) setSkills({ scope, phase: "ready", data: response.data, error: null });
      }).catch(error => {
        if (active && !controller.signal.aborted) setSkills({
          scope, phase: "error", data: null,
          error: error instanceof Error ? error.message : "Skill inventory unavailable.",
        });
      });
    return () => { active = false; controller.abort(); };
  }, [scope, retry, lastConnectedAt]);

  useEffect(() => {
    if (!scope) return;
    const controller = new AbortController();
    let active = true;
    queueMicrotask(() => { if (active) setRepositories({ scope, phase: "loading", data: null, error: null }); });
    void fetchRepositoryList({ workspaceSlug: scope, signal: controller.signal })
      .then(response => {
        if (active) setRepositories({ scope, phase: "ready", data: response.data, error: null });
      }).catch(error => {
        if (active && !controller.signal.aborted) setRepositories({
          scope, phase: "error", data: null,
          error: error instanceof Error ? error.message : "Repository inventory unavailable.",
        });
      });
    return () => { active = false; controller.abort(); };
  }, [scope, retry, lastConnectedAt]);

  // A late response from a previous tenant must never appear in the next tenant's UI.
  const skillState = skills.scope === scope ? skills : initialSkills;
  const repoState = repositories.scope === scope ? repositories : initialRepositories;
  const repositoryOptions = useMemo(() =>
    [...new Set((skillState.data ?? []).map(skill => skill.repo))].sort(),
    [skillState.data]);
  const filteredSkills = useMemo(
    () => filterUiV2Skills(skillState.data ?? [], term, stage, {
      tier: tierFilter, repository: repoFilter,
    }),
    [skillState.data, term, stage, tierFilter, repoFilter],
  );
  const filteredRepositories = useMemo(
    () => filterUiV2Repositories(repoState.data ?? [], term),
    [repoState.data, term],
  );
  const activeSelection = selected?.scope === scope ? selected.skill : null;
  const selectedId = activeSelection?.skillUuid ?? "";
  useEffect(() => {
    if (!scope || !selectedId) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted) setSkillDetail({
        scope, id: selectedId, data: null, loading: true, error: null,
      });
    });
    void fetchSkillDetail(selectedId, { workspaceSlug: scope, signal: controller.signal })
      .then(response => {
        if (!controller.signal.aborted) setSkillDetail({
          scope, id: selectedId, data: response.data, loading: false, error: null,
        });
      }).catch(error => {
        if (!controller.signal.aborted) setSkillDetail({
          scope, id: selectedId, data: null, loading: false,
          error: error instanceof Error ? error.message : "Skill detail is unavailable.",
        });
      });
    return () => controller.abort();
  }, [scope, selectedId]);
  useEffect(()=>{
    if(!scope||!selectedId||inspectorTab!=="dependencies")return;
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted)
      setAssetInventory({scope,id:selectedId,state:"loading",data:null,error:null});});
    void fetchSkillAssets(selectedId,{workspaceSlug:scope,signal:controller.signal}).then(response=>{
      if(!controller.signal.aborted)setAssetInventory({
        scope,id:selectedId,state:"ready",data:response.data,error:null,
      });
    }).catch(error=>{
      if(!controller.signal.aborted)setAssetInventory({
        scope,id:selectedId,state:"error",data:null,
        error:error instanceof Error?error.message:"Pinned Git asset inventory unavailable.",
      });
    });
    return ()=>controller.abort();
  },[scope,selectedId,inspectorTab]);

  const detailState = skillDetail.scope === scope && skillDetail.id === selectedId
    ? skillDetail : { scope, id: selectedId, data: null, loading: true, error: null };
  const detailHref = buildTenantAwareAppPath(pathname, "/repositories") as Route;
  const marketplaceHref = buildTenantAwareAppPath(pathname, "/catalog") as Route;

  return (
    <div className={styles.page}>
      <UiV2PageHeader title="Library" eyebrow="Workspace / governed assets"
        actions={<>
          <UiV2Button variant="tertiary" onClick={() => setRetry(x => x + 1)}>
            <Ic.Refresh className={styles.icon} aria-hidden="true" />Refresh
          </UiV2Button>
          <Link href={marketplaceHref} className={styles.secondaryLink}>Browse Public Library</Link>
          <UiV2Button onClick={show}>Connect repository</UiV2Button>
          <UiV2Button variant="primary" onClick={() => setCreateOpen(true)}>New skill</UiV2Button>
        </>} />

      <div className={styles.metrics}>
        <UiV2Metric label="Governed skills" value={skillState.phase === "ready" ? safeUiV2Count(skillState.data?.length) : null} />
        <UiV2Metric label="Connected repositories" value={repoState.phase === "ready" ? safeUiV2Count(repoState.data?.length) : null} />
        <UiV2Metric label="Repositories indexed" value={repoState.phase === "ready"
          ? repoState.data?.filter(repo => getUiV2RepositoryHealth(repo) === "ready").length
          : null} />
      </div>

      <div className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="Library sections"
          onKeyDown={event => {
            const next = nextUiV2LibrarySection(section, event.key);
            if (next === null) return;
            event.preventDefault();
            setSection(next);
            const id = next === "skills" ? "#sv2-skills-tab" : "#sv2-repos-tab";
            event.currentTarget.querySelector<HTMLButtonElement>(id)?.focus();
          }}>
          <button id="sv2-skills-tab" type="button" role="tab" aria-controls="sv2-library-list"
            aria-selected={section === "skills"} tabIndex={section === "skills" ? 0 : -1}
            onClick={() => setSection("skills")}>Skills</button>
          <button id="sv2-repos-tab" type="button" role="tab" aria-controls="sv2-library-list"
            aria-selected={section === "repositories"} tabIndex={section === "repositories" ? 0 : -1}
            onClick={() => setSection("repositories")}>Repositories</button>
          <Link href={marketplaceHref} className={styles.tabLink}>Public Library</Link>
          <span className={styles.disabledTab} aria-disabled="true">Opportunities · Planned</span>
        </div>
        <label className={styles.search}>
          <span className={styles.visuallyHidden}>Search {section}</span>
          <Ic.Search className={styles.icon} aria-hidden="true" />
          <input type="search" autoComplete="off" value={term}
            placeholder={section === "skills" ? "Search skills, teams, owners…" : "Search repositories…"}
            onChange={e => setTerm(e.target.value)} />
        </label>
        {section === "skills" ? (
          <label className={styles.filter}>
            <span className={styles.visuallyHidden}>Filter skills by channel</span>
            <select value={stage} onChange={e => setStage(e.target.value as LibraryStage)}>
              <option value="all">All channels</option>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="draft">Draft</option>
              <option value="candidate">Candidates</option>
            </select>
          </label>
        ) : null}
        {section === "skills" ? <>
          <label className={styles.filter}>
            <span className={styles.visuallyHidden}>Skill tier</span>
            <select value={tierFilter} onChange={event => setTierFilter(
              event.target.value === "all" ? "all" : Number(event.target.value) as 1 | 2 | 3
            )}>
              <option value="all">All tiers</option><option value="1">Tier 1</option>
              <option value="2">Tier 2</option><option value="3">Tier 3</option>
            </select>
          </label>
          <label className={styles.filter}>
            <span className={styles.visuallyHidden}>Repository</span>
            <select value={repoFilter} onChange={event => setRepoFilter(event.target.value)}>
              <option value="">All repositories</option>
              {repositoryOptions.map(repo => <option key={repo} value={repo}>{repo}</option>)}
            </select>
          </label>
          <div className={styles.tabs} role="group" aria-label="Inventory density">
            <button type="button" aria-pressed={!detailView} onClick={() => setDetailView(false)}>Compact</button>
            <button type="button" aria-pressed={detailView} onClick={() => setDetailView(true)}>Detailed</button>
          </div>
        </> : null}
      </div>

      <section id="sv2-library-list" className={styles.panel} role="tabpanel"
        aria-labelledby={section === "skills" ? "sv2-skills-tab" : "sv2-repos-tab"}>
        {section === "skills" ? (
          skillState.phase === "loading" ? <p className={styles.message} role="status">Loading workspace skills…</p> :
          skillState.phase === "error" ? (
            <div className={styles.error} role="alert">
              <span>Could not load skills: {skillState.error}</span>
              <UiV2Button onClick={() => setRetry(x => x + 1)}>Retry</UiV2Button>
            </div>
          ) : filteredSkills.length === 0 ? (
            <UiV2EmptyState message={term || stage !== "all" || tierFilter !== "all" || repoFilter
              ? "No skills match these filters." : "No indexed skills in this workspace. Connect and sync a repository to begin."} />
          ) : (
            <UiV2TableViewport label="Workspace governed skills">
              <table className={styles.table}>
                <thead><tr><th>Skill</th><th>Tier</th><th>Repository</th><th>Channel</th><th>Source revision</th><th>Quality</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{filteredSkills.map(skill => (
                  <tr key={skill.skillUuid}>
                    <td>
                      <Link href={buildSkillDetailPath(pathname, skill) as Route} className={styles.primaryLink}>
                        {skill.name}
                      </Link>
                      <span className={styles.subtext}>{skill.team} · {skill.owner}</span>
                      {detailView ? <span className={styles.subtext}>{skill.description}</span> : null}
                    </td>
                    <td>Tier {skill.tier}</td>
                    <td>{skill.repo}</td>
                    <td><span className={styles.mono}>{skill.channel}</span></td>
                    <td className={styles.mono}>{skill.projection.sourceCommitSha || "Not indexed"}</td>
                    <td className={styles.mono}>{skill.score !== null && Number.isFinite(skill.score)
                      ? skill.score.toFixed(1) : "Not available"}</td>
                    <td><UiV2Status state={skill.status.toLowerCase().includes("regress") ||
                      skill.status.toLowerCase().includes("fail") ? "failed" :
                      skill.score === null ? "unavailable" : "ready"}
                      label={skill.status || "No status"} /></td>
                    <td><UiV2Button size="small" onClick={() => {
                      setSelected({ scope, skill }); setInspectorTab("summary");
                    }}>Inspect</UiV2Button></td>
                  </tr>
                ))}</tbody>
              </table>
            </UiV2TableViewport>
          )
        ) : (
          repoState.phase === "loading" ? <p className={styles.message} role="status">Loading workspace repositories…</p> :
          repoState.phase === "error" ? (
            <div className={styles.error} role="alert">
              <span>Could not load repositories: {repoState.error}</span>
              <UiV2Button onClick={() => setRetry(x => x + 1)}>Retry</UiV2Button>
            </div>
          ) : filteredRepositories.length === 0 ? (
            <UiV2EmptyState message={term
              ? "No repositories match your search." : "No repositories connected. Use Connect repository to get started."} />
          ) : (
            <UiV2TableViewport label="Connected repositories">
              <table className={styles.table}>
                <thead><tr><th>Repository</th><th>Provider</th><th>Index state</th><th>Indexed assets</th><th>Provenance</th><th>Action</th></tr></thead>
                <tbody>{filteredRepositories.map(repository => {
                  const health = getUiV2RepositoryHealth(repository);
                  return <tr key={repository.id}>
                    <td><strong>{repository.name}</strong><span className={styles.subtext}>{repository.branch}</span></td>
                    <td>{repository.provider}</td>
                    <td><UiV2Status state={health === "ready" ? "ready" : health === "action-required" ? "warning" : health === "indexing" ? "running" : "unavailable"}
                      label={health === "not-indexed" ? "Not indexed" : health === "indexing" ? "Indexing" :
                        health === "action-required" ? "Review connection" : "Indexed"} /></td>
                    <td className={styles.mono}>{safeUiV2Count(repository.skills) ?? "Not available"}</td>
                    <td className={styles.mono}>{uiV2ProvenanceNote(repository)}</td>
                    <td><Link href={detailHref} className={styles.primaryLink}>Manage</Link></td>
                  </tr>;
                })}</tbody>
              </table>
            </UiV2TableViewport>
          )
        )}
      </section>

      <p className={styles.help}>
        Repository synchronization and assessment remain available under <Link href={detailHref}>Repositories</Link>.
        Browse the <Link href={marketplaceHref}>Public Library</Link> to import external skills into an authorized Git repository through a reviewed proposal.
      </p>
      <UiV2InspectorDrawer id="sv2-skill-inspector" title={activeSelection?.name ?? "Skill"}
        open={Boolean(activeSelection)} onClose={() => setSelected(null)}
        actions={activeSelection ? <>
          <Link href={buildSkillDetailPath(pathname, activeSelection) as Route}
            className={styles.secondaryLink} onClick={() => setSelected(null)}>Open Workbench</Link>
        </> : undefined}>
        {activeSelection ? <>
          <div className={styles.detailTabs} role="tablist" aria-label="Skill inspector">
            {(["summary", "versions", "usage", "dependencies"] as const).map(tab =>
              <button type="button" role="tab" key={tab}
                aria-selected={inspectorTab === tab} onClick={() => setInspectorTab(tab)}>
                {tab === "summary" ? "Summary" : tab === "versions" ? "Versions" :
                  tab === "usage" ? "Usage" : "Dependencies"}
              </button>)}
          </div>
          {detailState.loading ? <p role="status">Loading authorized skill details…</p> :
            detailState.error ? <UiV2StateBanner state="unavailable" label={detailState.error} /> :
            detailState.data ? <>
              {inspectorTab === "summary" ? <div className={styles.inspectorSummary}>
                <section className={styles.skillPurpose} aria-label="Skill purpose">
                  <h3>Purpose</h3>
                  <p>{activeSelection.description?.trim()||
                    "No summary is available in this skill's indexed Git metadata."}</p>
                </section>
                <dl className={styles.inspectorData}>
                  <dt>Tier</dt><dd>Tier {activeSelection.tier}</dd>
                  <dt>Owner / team</dt><dd>{activeSelection.owner} · {activeSelection.team}</dd>
                  <dt>Channel</dt><dd>{activeSelection.channel}</dd>
                  <dt>State</dt><dd>{activeSelection.status}</dd>
                  <dt>Repository</dt><dd>{activeSelection.repo}</dd>
                  <dt>Provider</dt><dd>{activeSelection.repoProvider}</dd>
                  <dt>Indexed path</dt><dd className={styles.mono}>{activeSelection.projection.sourcePath??"Not reported"}</dd>
                  <dt>Source revision</dt><dd className={styles.mono}>
                    {activeSelection.projection.sourceCommitSha??"Not indexed"}</dd>
                  <dt>Recorded quality</dt><dd>{Number.isFinite(activeSelection.score)&&activeSelection.score!==null
                    ?activeSelection.score.toFixed(1):"Not available"}</dd>
                  <dt>Recorded versions</dt><dd>{detailState.data.versionHistory.length}</dd>
                  <dt>Access group</dt><dd>{activeSelection.accessGroup||"Not reported"}</dd>
                </dl>
                <section className={styles.skillPurpose} aria-label="Evaluation summary">
                  <h3>Latest recorded evaluation</h3>
                  {detailState.data.evaluations.length?(()=>{
                    const result=detailState.data.evaluations[0]!;
                    return <div className={styles.evaluationSynopsis}>
                      <Link href={buildTenantAwareAppPath(pathname,
                        `/evaluations/${encodeURIComponent(result.id)}`) as Route}>
                        {result.dataset}</Link>
                      <span>{result.status} · {result.passed}/{result.cases} cases passed</span>
                      <small>Recorded against {result.ref}; not proof of a current provider-backed execution.</small>
                    </div>;
                  })():<p>No evaluation history is recorded for this skill.</p>}
                </section>
              </div> : null}
              {inspectorTab === "versions" ? detailState.data.versionHistory.length > 0
                ? <ul className={styles.inspectorList}>{detailState.data.versionHistory.map(version =>
                  <li key={version.commit}><strong>{version.ref}</strong><span>{version.channel} · {version.when}</span>
                    <code>{version.commit}</code></li>)}</ul>
                : <UiV2EmptyState message="No source versions recorded." /> : null}
              {inspectorTab === "usage" ? detailState.data.evaluations.length > 0
                ? <ul className={styles.inspectorList}>{detailState.data.evaluations.map(run =>
                  <li key={run.id}><Link href={buildTenantAwareAppPath(pathname,
                    `/evaluations/${encodeURIComponent(run.id)}`) as Route}>
                    {run.dataset}</Link><span>{run.status} · {run.passed}/{run.cases} cases</span></li>)}</ul>
                : <UiV2EmptyState message="No evaluation runs recorded for this skill." /> : null}
              {inspectorTab === "dependencies" ? <>
                {assetInventory.scope!==scope||assetInventory.id!==selectedId||
                  assetInventory.state==="loading"?<p role="status">Loading pinned Git dependencies…</p>:
                  assetInventory.state==="error"?<UiV2StateBanner state="unavailable"
                    label={assetInventory.error??"Repository dependency inventory unavailable."}/>:
                  assetInventory.data?<div className={styles.inspectorSummary}>
                    <section className={styles.skillPurpose}><h3>Observed Git files</h3>
                      <p>{assetInventory.data.files.length} verified file path(s), pinned to
                        commit {assetInventory.data.commitSha.slice(0,12)}.
                        {assetInventory.data.omitted>0?` ${assetInventory.data.omitted} omitted due to inventory limits.`:""}</p>
                      <ul className={styles.inspectorList}>{assetInventory.data.files.slice(0,15).map(file=>
                        <li key={file.path}><strong>{file.relativePath}</strong><span>{file.kind}</span></li>)}</ul>
                    </section>
                    <section className={styles.skillPurpose}><h3>Declared Markdown references</h3>
                      {assetInventory.data.links.length===0?
                        <p>No Markdown references declared in this SKILL.md.
                          Other source files alone do not prove runtime dependencies.</p>:
                        <ul className={styles.inspectorList}>{assetInventory.data.links.map((link,index)=>
                          <li key={`${link.raw}-${index}`}>
                            <strong>{link.raw}</strong>
                            <span>{link.status} · source line {link.line}</span>
                          </li>)}</ul>}
                    </section>
                    <p>Authored Git references are not observed tool calls or runtime lineage.</p>
                  </div>:null}
              </> : null}
            </> : null}
        </> : null}
      </UiV2InspectorDrawer>
      <SkillCreateModal open={createOpen} onClose={() => setCreateOpen(false)}
        onApplied={() => setRetry(x => x + 1)} />
    </div>
  );
}
