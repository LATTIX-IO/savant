"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect,useMemo,useState } from "react";
import { usePathname } from "next/navigation";
import type { SkillListItem } from "@savant/types";
import type { TestBenchDefinition } from "@/server/test-bench/definition-contract";
import type { ObservedRunSummary } from "@/server/test-bench/observed-run-store";
import { fetchSkillList } from "@/lib/control-plane-client";
import { listPersistedTestBenches } from "@/lib/test-bench-client";
import { listObservedTestBenchRuns } from "@/lib/observed-test-bench-runs";
import { buildTenantAwareAppPath } from "@/lib/tenant-paths";
import { useUiV2WorkspaceSlug } from "@/components/savant/ui-v2/mode";
import { UiV2EmptyState,UiV2Metric,UiV2PageHeader,UiV2StateBanner,
 UiV2Status,UiV2TableViewport } from "@/components/savant/ui-v2";
import { runEvidenceStatus,selectObservedRuns,type RunsFilter } from "@/lib/ui-v2-runs-model";
import styles from "./runs-v2.module.css";
type Inventory={scope:string;skills:readonly SkillListItem[]|null;loading:boolean;error:string|null};
type SuiteState={scope:string;id:string;suites:readonly TestBenchDefinition[]|null;loading:boolean;error:string|null};
type RunState={scope:string;runs:readonly ObservedRunSummary[]|null;loading:boolean;error:string|null};
const EMPTY:Inventory={scope:"",skills:null,loading:true,error:null};
const EMPTY_SUITE:SuiteState={scope:"",id:"",suites:null,loading:true,error:null};
const EMPTY_RUN:RunState={scope:"",runs:null,loading:true,error:null};

export function RunsV2() {
 const slug=useUiV2WorkspaceSlug()??"";
 const pathname=usePathname()||"/";
 const [inventory,setInventory]=useState<Inventory>(EMPTY);
 const [allSuites,setAllSuites]=useState<SuiteState>(EMPTY_SUITE);
 const [observed,setObserved]=useState<RunState>(EMPTY_RUN);
 const [skillSelection,setSkillSelection]=useState("");
 const [suiteSelection,setSuiteSelection]=useState("");
 const [runSelection,setRunSelection]=useState("");
 const [caseSelection,setCaseSelection]=useState("");
 const [query,setQuery]=useState("");
 const [filter,setFilter]=useState<RunsFilter>("all");
 const [refresh,setRefresh]=useState(0);
 useEffect(()=>{
   if(!slug)return;
   const controller=new AbortController();
   queueMicrotask(()=>{if(!controller.signal.aborted)setInventory({...EMPTY,scope:slug});});
   void fetchSkillList(undefined,{workspaceSlug:slug,signal:controller.signal})
     .then(response=>{if(!controller.signal.aborted)setInventory({
       scope:slug,skills:response.data,loading:false,error:null});})
     .catch(()=>{if(!controller.signal.aborted)setInventory({
       scope:slug,skills:null,loading:false,error:"Authorized skill inventory unavailable."});});
   return ()=>controller.abort();
 },[slug,refresh]);
 const activeInventory=inventory.scope===slug?inventory:EMPTY;
 const skill=activeInventory.skills?.find(item=>item.id===skillSelection)??
   activeInventory.skills?.[0]??null;
 const skillId=skill?.id??"";
 useEffect(()=>{
   if(!skillId||!slug)return;
   const controller=new AbortController();
   queueMicrotask(()=>{if(!controller.signal.aborted)setAllSuites({...EMPTY_SUITE,scope:slug,id:skillId});});
   void listPersistedTestBenches(skillId,{workspaceSlug:slug,signal:controller.signal})
     .then(suites=>{if(!controller.signal.aborted)setAllSuites({
       scope:slug,id:skillId,suites,loading:false,error:null});})
     .catch(()=>{if(!controller.signal.aborted)setAllSuites({
       scope:slug,id:skillId,suites:null,loading:false,
       error:"Saved suites cannot be loaded. Confirm database and key readiness."});});
   return ()=>controller.abort();
 },[slug,skillId,refresh]);
 const saved=allSuites.scope===slug&&allSuites.id===skillId?allSuites:EMPTY_SUITE;
 const suite=saved.suites?.find(x=>x.id===suiteSelection)??saved.suites?.[0]??null;
 const scope=suite?`${slug}:${skillId}:${suite.id}:${suite.sourceCommitSha}`:"";
 useEffect(()=>{
   if(!suite||!scope)return;
   const controller=new AbortController();
   queueMicrotask(()=>{if(!controller.signal.aborted)setObserved({...EMPTY_RUN,scope});});
   void listObservedTestBenchRuns(skillId,suite.id,suite.sourceCommitSha,
     {workspaceSlug:slug,signal:controller.signal})
     .then(runs=>{if(!controller.signal.aborted)setObserved({
       scope,runs,loading:false,error:null});})
     .catch(()=>{if(!controller.signal.aborted)setObserved({
       scope,runs:null,loading:false,
       error:"Observed runs could not be verified. No results will be inferred."});});
   return ()=>controller.abort();
 },[slug,skillId,scope,suite,refresh]);
 const record=observed.scope===scope?observed:EMPTY_RUN;
 const visible=useMemo(()=>selectObservedRuns(record.runs??[],query,filter),[record.runs,query,filter]);
 const run=visible.find(item=>item.id===runSelection)??visible[0]??null;
 const sample=run?.samples.find(item=>item.caseId===caseSelection)??run?.samples[0]??null;
 const evidence=run?runEvidenceStatus(run):null;
 const total=record.runs?.length??null;
 const completed=record.runs?.filter(item=>item.status==="complete").length??null;
 const active=record.runs?.filter(item=>item.status==="queued"||item.status==="running").length??null;
 const qualityHref=buildTenantAwareAppPath(pathname,"/evaluations") as Route;
 return <div className={styles.page}>
   <UiV2PageHeader eyebrow="Quality engineering / immutable observations"
     title="Runs" description="Inspect the persisted provider-backed evidence belonging to a selected skill and suite."
     actions={<button type="button" className={styles.control}
       onClick={()=>setRefresh(value=>value+1)}>Refresh from source</button>}/>
   <div className={styles.measures}>
     <UiV2Metric label="Observed runs in selected suite" value={total}/>
     <UiV2Metric label="Completed runs" value={completed}/>
     <UiV2Metric label="Queued or running" value={active}/>
     <UiV2Metric label="Provider step traces" value={null}/>
   </div>
   <div className={styles.filters}>
     <label>Skill <select value={skillId} disabled={!activeInventory.skills?.length}
       onChange={event=>{setSkillSelection(event.target.value);
         setSuiteSelection("");setRunSelection("");setCaseSelection("");}}>
       {(activeInventory.skills??[]).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
     </select></label>
     <label>Saved suite <select value={suite?.id??""} disabled={!saved.suites?.length}
       onChange={event=>{setSuiteSelection(event.target.value);setRunSelection("");setCaseSelection("");}}>
       {(saved.suites??[]).map(item=><option key={item.id} value={item.id}>
         {item.name} · rev {item.revision}</option>)}
     </select></label>
     <label>Filter runs <input type="search" value={query}
       onChange={event=>setQuery(event.target.value)} placeholder="Run ID or provider"/></label>
     <label>Status <select value={filter} onChange={event=>setFilter(event.target.value as RunsFilter)}>
       <option value="all">All</option><option value="active">Active</option><option value="complete">Complete</option>
       <option value="failed">Failed</option><option value="canceled">Canceled</option>
     </select></label>
   </div>
   {activeInventory.error?<UiV2StateBanner state="unavailable" label={activeInventory.error}/>:null}
   {saved.error?<UiV2StateBanner state="unavailable" label={saved.error}/>:null}
   {record.error?<UiV2StateBanner state="unavailable" label={record.error}/>:null}
   <div className={styles.split}>
     <nav className={styles.runList} aria-label="Observed suite runs">
       <h2>Observed run records</h2>
       {record.loading?<p role="status">Loading verified run receipts…</p>:
        !suite?<UiV2EmptyState message="Choose a saved, source-pinned suite to inspect runs."/>:
        visible.length===0?<UiV2EmptyState message="No observed runs in this suite match the filter."/>:
        visible.map(item=><button type="button" key={item.id}
         aria-current={item.id===run?.id?"true":undefined} onClick={()=>{setRunSelection(item.id);setCaseSelection("");}}>
         <small>{item.id}</small><strong>{item.executionSource}</strong>
         <span>{item.status} · {item.completedCases}/{item.expectedCases} observed cases</span>
       </button>)}
     </nav>
     <section className={styles.inspector} aria-label="Run inspector">
       {!run||!suite?<UiV2EmptyState message="No selected observed run evidence."/>:<>
         <div className={styles.inspectorTitle}>
           <div><small>Run / {run.id}</small><h2>{skill?.name??"Skill"}</h2></div>
           <UiV2Status state={run.status==="complete"?"ready":
             run.status==="failed"?"failed":run.status==="canceled"?"warning":"running"}
             label={run.status}/>
         </div>
         <div className={styles.gates}>
           <div><strong>Git source revision</strong><code>{run.sourceCommitSha}</code></div>
           <div><strong>Suite revision</strong><span>{run.definitionRevision}</span></div>
           <div><strong>Executor</strong><span>{run.executionModelPinned??run.executionModel??"Not reported"}</span></div>
           <div><strong>Observed usage receipts</strong><span>{run.observedUsageReceipts}</span></div>
           <div><strong>Unconfirmed provider calls</strong><span>{run.unconfirmedProviderCalls}</span></div>
           <div><strong>Normalized QA cost estimate</strong><span>
             {evidence?.cost!==null&&evidence?.cost!==undefined?
               `$${evidence.cost.toFixed(5)}`:"Not available"}</span></div>
         </div>
         <UiV2StateBanner state="unavailable"
           label="Normalized QA estimates are not provider invoices or verified billing totals."/>
         {run.status==="queued"||run.status==="running"?<progress max={run.expectedCases}
           value={run.completedCases} aria-label="Observed case execution progress" className={styles.progress}/>:null}
         <div className={styles.panelTitle}><h3>Case matrix · {run.samples.length} observed</h3>
           <span>{evidence?.failures} failed · {evidence?.investigations} investigate</span></div>
         {run.samples.length===0?<UiV2EmptyState message="No provider-observed case results yet."/>:
           <div className={styles.matrix} role="group" aria-label="Observed case outcomes">
             {run.samples.map(item=><button key={item.caseId} type="button"
               aria-pressed={sample?.caseId===item.caseId}
               className={item.verdict==="fail"?styles.fail:item.verdict==="investigate"?styles.warn:styles.ok}
               title={`${item.caseId} · ${item.verdict}`} onClick={()=>setCaseSelection(item.caseId)}>
               {item.caseId}
             </button>)}
           </div>}
         <div className={styles.panelTitle}><h3>Case evidence</h3></div>
         {sample?<dl className={styles.caseDetail}>
           <dt>Case ID</dt><dd>{sample.caseId}</dd>
           <dt>Verdict</dt><dd>{sample.verdict}</dd>
           <dt>Judge expected behavior met</dt><dd>{sample.expectedMet}</dd>
           <dt>Case latency</dt><dd>{sample.latencyMs} ms</dd>
           <dt>Judge model</dt><dd>{sample.judgeModel}</dd>
           <dt>Observed output</dt><dd><pre className={styles.output}>{sample.output}</pre></dd>
         </dl>:<UiV2EmptyState message="Select an observed case to inspect its outcome."/>}
         <div className={styles.panelTitle}><h3>Execution steps</h3></div>
         {!evidence?.hasStepSpans?<UiV2StateBanner state="unavailable"
           label="Step-level waterfall, tool calls, logs and timing spans are not supplied by this execution API."/>:null}
         <p className={styles.note}>A failure cluster cannot be inferred from one judge verdict.
           Raw prompts and credentials are never replicated to the browser beyond server-authorized evidence fields.
           This page does not approve releases, settle billing or execute models.</p>
         <Link href={qualityHref} className={styles.backLink}>Open Evaluations</Link>
       </>}
     </section>
   </div>
 </div>;
}
