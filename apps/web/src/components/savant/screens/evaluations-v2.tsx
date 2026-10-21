"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { EvaluationDashboardPayload, SkillListItem, SkillSourcePayload } from "@savant/types";
import { useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { UiV2EmptyState, UiV2Metric, UiV2PageHeader, UiV2StateBanner, UiV2Status,
  UiV2TableViewport } from "@/components/savant/ui-v2";
import { fetchEvaluationDashboard, fetchSkillList, fetchSkillSource } from "@/lib/control-plane-client";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import { listPersistedTestBenches } from "@/lib/test-bench-client";
import type { TestBenchDefinition } from "@/server/test-bench/definition-contract";
import { PersistedTestBench } from "./persisted-test-bench";
import { evaluationLifecycle, visibleEvaluationRuns } from "@/lib/ui-v2-evaluations-model";
import styles from "./evaluations-v2.module.css";

type Inventory = {scope:string; phase:"loading"|"ready"; skills:readonly SkillListItem[]|null;
  dashboard:EvaluationDashboardPayload|null; errors:readonly string[]};
type Definitions = {scope:string;skillId:string;phase:"loading"|"ready"|"error";
  definitions:readonly TestBenchDefinition[]|null;error:string|null};
type Source = {scope:string;skillId:string;ready:boolean;source:SkillSourcePayload|null};
const INIT:Inventory={scope:"",phase:"loading",skills:null,dashboard:null,errors:[]};
const INIT_DEFS:Definitions={scope:"",skillId:"",phase:"loading",definitions:null,error:null};

export function EvaluationsV2() {
  const slug=useUiV2WorkspaceSlug()??"";
  const pathname=usePathname()||"/";
  const [inventory,setInventory]=useState<Inventory>(INIT);
  const [definitions,setDefinitions]=useState<Definitions>(INIT_DEFS);
  const [source,setSource]=useState<Source>({scope:"",skillId:"",ready:false,source:null});
  const [requestedSkill,setRequestedSkill]=useState("");
  const [tab,setTab]=useState<"suites"|"datasets"|"auto">("suites");
  const [query,setQuery]=useState("");
  const [filter,setFilter]=useState<"all"|"running"|"completed"|"issues">("all");
  const [reload,setReload]=useState(0);
  useEffect(()=>{
    if(!slug)return;
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted)setInventory({...INIT,scope:slug});});
    void Promise.allSettled([
      fetchSkillList(undefined,{workspaceSlug:slug,signal:controller.signal}),
      fetchEvaluationDashboard({workspaceSlug:slug,signal:controller.signal}),
    ]).then(([skills,activity])=>{
      if(controller.signal.aborted)return;
      setInventory({scope:slug,phase:"ready",
        skills:skills.status==="fulfilled"?skills.value.data:null,
        dashboard:activity.status==="fulfilled"?activity.value.data:null,
        errors:[
          ...(skills.status==="rejected"?["Authorized skill inventory unavailable."]:[]),
          ...(activity.status==="rejected"?["Evaluation dashboard unavailable."]:[]),
        ]});
    });
    return ()=>controller.abort();
  },[slug,reload]);
  const visible=inventory.scope===slug?inventory:INIT;
  const skills=visible.skills??[];
  const selected=skills.find(s=>s.id===requestedSkill)??skills[0]??null;
  const skillId=selected?.id??"";
  useEffect(()=>{
    if(!slug||!skillId)return;
    const controller=new AbortController();
    queueMicrotask(()=>{if(!controller.signal.aborted){
      setDefinitions({...INIT_DEFS,scope:slug,skillId});
      setSource({scope:slug,skillId,ready:false,source:null});
    }});
    void Promise.allSettled([
      listPersistedTestBenches(skillId,{workspaceSlug:slug,signal:controller.signal}),
      fetchSkillSource(skillId,{workspaceSlug:slug,signal:controller.signal}),
    ]).then(([suites,indexed])=>{
      if(controller.signal.aborted)return;
      setDefinitions({scope:slug,skillId,phase:suites.status==="fulfilled"?"ready":"error",
        definitions:suites.status==="fulfilled"?suites.value:null,
        error:suites.status==="rejected"?
          "Saved suites unavailable. Production database/key activation may still be required.":null});
      setSource({scope:slug,skillId,ready:true,
        source:indexed.status==="fulfilled"?indexed.value.data:null});
    });
    return ()=>controller.abort();
  },[slug,skillId,reload]);
  const saved=definitions.scope===slug&&definitions.skillId===skillId
    ?definitions:INIT_DEFS;
  const indexed=source.scope===slug&&source.skillId===skillId&&source.ready?source.source:null;
  const canAuthor=Boolean(indexed&&indexed.mode==="repository"&&indexed.canSave&&
    indexed.sourceCommitSha);
  const counts=evaluationLifecycle(visible.dashboard,saved.definitions);
  const runs=useMemo(()=>visibleEvaluationRuns(visible.dashboard?.runs??[],query,filter),
    [visible.dashboard,query,filter]);
  const evalHref=buildTenantAwareAppPath(pathname,"/evaluations") as Route;
  return <div className={styles.page}>
    <UiV2PageHeader eyebrow="Workspace / quality engineering" title="Evaluations"
      description="Define source-pinned suites, execute only admitted providers, and inspect recorded outcomes."
      actions={<button type="button" className={styles.button} onClick={()=>setReload(x=>x+1)}>Refresh evidence</button>}/>
    {visible.errors.map(message=><UiV2StateBanner key={message} state="unavailable" label={message}/>)}
    <div className={styles.lifecycle} aria-label="Definition, execution and results lifecycle">
      <div><span>1 · Definition</span><UiV2Metric label="Saved suites for selected skill" value={counts.definitions}/></div>
      <div><span>2 · Execution</span><UiV2Metric label="Running indexed evaluations shown" value={counts.running}/></div>
      <div><span>3 · Results</span><UiV2Metric label="Completed indexed evaluations shown" value={counts.completed}/></div>
    </div>
    <div className={styles.tabs} role="tablist" aria-label="Evaluation areas">
      <button role="tab" aria-selected={tab==="suites"} type="button" onClick={()=>setTab("suites")}>Suites</button>
      <button role="tab" aria-selected={tab==="datasets"} type="button" onClick={()=>setTab("datasets")}>Datasets</button>
      <button role="tab" aria-selected={tab==="auto"} type="button" onClick={()=>setTab("auto")}>Auto-Improve · Planned</button>
    </div>
    <section className={styles.section} role="tabpanel">
      {tab==="auto"?<UiV2StateBanner state="planned"
        label="Autonomous improvement is not enabled; proposals and approvals remain human governed."/>:
      <div className={styles.columns}>
        <div className={styles.primary}>
          <label className={styles.skillSelect} htmlFor="sv2-eval-skill">
            <span>Authorized skill</span>
            <select id="sv2-eval-skill" value={skillId} disabled={skills.length===0}
              onChange={event=>setRequestedSkill(event.target.value)}>
              {skills.map(skill=><option key={skill.id} value={skill.id}>
                {skill.name} · Tier {skill.tier}</option>)}
            </select>
          </label>
          {visible.phase==="loading"?<p role="status">Loading workspace evaluations…</p>:
            selected===null?<UiV2EmptyState message="No indexed skills available. Connect a repository in Library first."/>:
            saved.phase==="error"?<UiV2StateBanner state="unavailable"
              label={saved.error??"Saved Test Bench could not be loaded."}/>:
            tab==="datasets"?(
              saved.definitions===null?<p role="status">Loading saved dataset cases…</p>:
              saved.definitions.length===0?<UiV2EmptyState message="No saved suite case datasets for this skill."/>:
              <UiV2TableViewport label="Persisted Test Bench case datasets"><table className={styles.table}>
                <thead><tr><th>Suite</th><th>Git commit</th><th>Revision</th><th>Cases</th><th>Source</th></tr></thead>
                <tbody>{saved.definitions.map(def=><tr key={def.id}>
                  <td>{def.name}</td><td className={styles.mono}>{def.sourceCommitSha}</td>
                  <td>{def.revision}</td><td>{def.cases.length}</td>
                  <td>Encrypted saved suite</td>
                </tr>)}</tbody></table></UiV2TableViewport>
            ):(
              <>
                {!canAuthor?<UiV2StateBanner state="unavailable"
                  label="Editing disabled until this workspace has an authorized, pinned Git source and role."/>:null}
                <PersistedTestBench key={slug+":"+skillId} skillId={skillId}
                  pathname={pathname} readOnly={!canAuthor}/>
              </>
            )}
          <p className={styles.note}>Reference dataset catalog is not available from the production API.
            Cases belong to encrypted, revisioned suites; no workspace-wide dataset inventory is inferred.
            Estimated run cost is not a provider billing receipt. Runtime/Test Bench activation may be unavailable
            until production key and schema recovery gates complete.</p>
        </div>
        <aside className={styles.aside}>
          <h2>Coverage by tier</h2>
          {visible.dashboard?.coverageByTier.length?visible.dashboard.coverageByTier.map(item=>
            <div key={item.tier} className={styles.coverage}>
              <span>Tier {item.tier}</span>
              <progress max={100} value={Number.isFinite(item.coveragePct)?
                Math.min(100,Math.max(0,item.coveragePct)):0}/>
              <span>{item.evaluatedSkills}/{item.totalSkills}</span>
            </div>):<UiV2EmptyState message="Coverage evidence unavailable."/>}
          <h2>Recent indexed results</h2>
          {visible.dashboard?.runs.length?visible.dashboard.runs.slice(0,7).map(run=>
            <Link key={run.id} className={styles.result}
              href={buildTenantAwareAppPath(pathname,
                "/evaluations/"+encodeURIComponent(run.id)) as Route}>
              <strong>{run.skill}</strong><small>{run.status} · {run.passed}/{run.cases} cases</small>
            </Link>):<UiV2EmptyState message="No indexed evaluation history."/>}
        </aside>
      </div>}
    </section>
    <section className={styles.section}>
      <header className={styles.sectionTitle}><h2>Evaluation activity</h2>
        <Link href={evalHref}>Current evaluations</Link></header>
      <div className={styles.filters}>
        <label>Filter observed dashboard runs <input type="search" value={query}
          onChange={event=>setQuery(event.target.value)} placeholder="Skill, run ID, dataset"/></label>
        <label>Run status <select value={filter}
          onChange={event=>setFilter(event.target.value as typeof filter)}>
          <option value="all">All</option><option value="running">Running</option>
          <option value="completed">Completed</option><option value="issues">Issues</option>
        </select></label>
      </div>
      {!visible.dashboard?<UiV2EmptyState message="No available evaluation dashboard evidence."/>:
        runs.length===0?<UiV2EmptyState message="No runs match the selected filters."/>:
        <UiV2TableViewport label="Indexed evaluations"><table className={styles.table}>
          <thead><tr><th>Run</th><th>Skill</th><th>Dataset</th><th>Cases</th><th>Status</th></tr></thead>
          <tbody>{runs.map(run=><tr key={run.id}>
            <td><Link href={buildTenantAwareAppPath(pathname,
              "/evaluations/"+encodeURIComponent(run.id)) as Route}>{run.id}</Link></td>
            <td>{run.skill}</td><td>{run.dataset}</td>
            <td>{run.passed}/{run.cases}</td><td><UiV2Status
              state={run.status==="running"?"running":run.status==="failed"||
                run.status==="complete-with-regressions"?"failed":"ready"}
              label={run.status}/></td>
          </tr>)}</tbody>
        </table></UiV2TableViewport>}
    </section>
  </div>;
}
