"use client";

import {useEffect,useRef,useState} from "react";
import type {TestBenchCase,TestBenchCaseKind,TestBenchDefinition} from "@/server/test-bench/definition-contract";
import {parseTestBenchCases} from "@/server/test-bench/definition-contract";
import type {ObservedRunSummary} from "@/server/test-bench/observed-run-store";
import {listObservedTestBenchRuns} from "@/lib/observed-test-bench-runs";
import {listPersistedTestBenches,createPersistedTestBench,updatePersistedTestBench,
 archivePersistedTestBench,TestBenchClientError} from "@/lib/test-bench-client";
import {extractWorkspaceSlugFromPathname} from "@/lib/tenant-paths";
import {UiV2InspectorDrawer,UiV2StateBanner} from "@/components/savant/ui-v2";
import {ObservedTestBenchRunPanel} from "./observed-test-bench-run-panel";
import {ObservedRunComparisonPanel} from "./observed-run-comparison-panel";
import {TestBenchAvailabilityNotice} from "./test-bench-availability-notice";
import styles from "./persisted-test-bench-cases-v2.module.css";

const newCase=():TestBenchCase=>({
 caseId:"case-"+crypto.randomUUID().slice(0,8),kind:"positive",
 prompt:"",context:null,expectedBehavior:"",
});
const KINDS:readonly TestBenchCaseKind[]=["positive","negative","edge","escalation"];
type Inventory={scope:string;loading:boolean;definitions:readonly TestBenchDefinition[];
 error:TestBenchClientError|null};
const EMPTY:Inventory={scope:"",loading:true,definitions:[],error:null};
type Runs={scope:string;loading:boolean;runs:readonly ObservedRunSummary[];error:string|null};
const NO_RUNS:Runs={scope:"",loading:true,runs:[],error:null};

/** A human-facing list of actual persisted cases and provider-observed verdicts.
 * The drawer is authoring UI; no evaluations, scores or provider charges are
 * synthesized from an indexed baseline. */
export function PersistedTestBenchCasesV2({
 skillId,pathname,readOnly,
}:{skillId:string;pathname:string;readOnly:boolean}){
 const slug=extractWorkspaceSlugFromPathname(pathname)??"";
 const scope=slug+":"+skillId;
 const [inventory,setInventory]=useState<Inventory>(EMPTY);
 const [runs,setRuns]=useState<Runs>(NO_RUNS);
 const [selectedId,setSelectedId]=useState("");
 const [drawerOpen,setDrawerOpen]=useState(false);
 const [editingId,setEditingId]=useState<string|null>(null);
 const [suiteName,setSuiteName]=useState("");
 const [form,setForm]=useState<TestBenchCase>(newCase);
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState("");
 const [error,setError]=useState("");
 const [reload,setReload]=useState(0);
 const requestId=useRef<string|null>(null);
 const inv=inventory.scope===scope?inventory:EMPTY;
 const selected=inv.definitions.find(x=>x.id===selectedId)??inv.definitions[0]??null;
 const activeId=selected?.id??"";
 const runScope=selected?`${scope}:${selected.id}:${selected.revision}:${selected.sourceCommitSha}`:"";
 const observed=runs.scope===runScope?runs:NO_RUNS;
 const currentRun=observed.runs.find(run=>run.status==="complete"&&
  run.definitionRevision===selected?.revision&&run.sourceCommitSha===selected.sourceCommitSha)??null;
 const editable=Boolean(slug&&!readOnly&&!busy&&!inv.loading&&!inv.error);
 const canAppend=Boolean(selected&&selected.cases.length<8);
 const mode=editingId==="__new-suite"?"new-suite":editingId?"edit":"add";
 const heading=mode==="new-suite"?"Create a new suite and case":
  mode==="edit"?"Edit saved case":"New test case";

 useEffect(()=>{
  if(!slug||!skillId)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setInventory({...EMPTY,scope});});
  void listPersistedTestBenches(skillId,{workspaceSlug:slug,signal:controller.signal}).then(data=>{
   if(!controller.signal.aborted)setInventory({scope,loading:false,definitions:data,error:null});
  }).catch(err=>{
   if(!controller.signal.aborted)setInventory({scope,loading:false,definitions:[],
    error:err instanceof TestBenchClientError?err:
      new TestBenchClientError("Saved encrypted suites could not be loaded.")});
  });
  return ()=>controller.abort();
 },[slug,skillId,scope,reload]);

 useEffect(()=>{
  if(!slug||!selected||!runScope)return;
  const controller=new AbortController();
  queueMicrotask(()=>{if(!controller.signal.aborted)setRuns({...NO_RUNS,scope:runScope});});
  void listObservedTestBenchRuns(skillId,selected.id,selected.sourceCommitSha,{
   workspaceSlug:slug,signal:controller.signal,
  }).then(value=>{
   if(!controller.signal.aborted)setRuns({scope:runScope,loading:false,runs:value,error:null});
  }).catch(err=>{
   if(!controller.signal.aborted)setRuns({scope:runScope,loading:false,runs:[],
    error:err instanceof Error?err.message:"Observed case results could not be loaded."});
  });
  return ()=>controller.abort();
 },[slug,skillId,selected?.id,selected?.revision,selected?.sourceCommitSha,runScope]);

 function begin(item:TestBenchCase|null,newSuite=false){
  if(!editable)return;
  if(!newSuite&&!item&&!canAppend)return;
  requestId.current=null;
  setForm(item?{...item}:newCase());
  setEditingId(newSuite?"__new-suite":item?.caseId??null);
  setSuiteName(newSuite?"New Test Bench":selected?.name??"");
  setError("");setNotice("");setDrawerOpen(true);
 }
 function close(){
  if(busy)return;
  setDrawerOpen(false);setEditingId(null);setError("");
 }
 async function save(){
  if(!slug||!editable||!drawerOpen)return;
  setBusy(true);setError("");setNotice("");
  try{
   const cases=mode==="new-suite"?[form]:mode==="edit"&&selected?
     selected.cases.map(c=>c.caseId===form.caseId?form:c):
     selected?[...selected.cases,form]:[form];
   const verified=parseTestBenchCases(cases);
   if(mode!=="new-suite"&&!selected)throw new Error("Select a suite before adding a case.");
   let updated:TestBenchDefinition;
   if(mode==="new-suite"){
    updated=await createPersistedTestBench(skillId,{name:suiteName,cases:verified,
     requestId:requestId.current??(requestId.current=crypto.randomUUID())},{
      workspaceSlug:slug,
     });
   }else{
    updated=await updatePersistedTestBench(skillId,selected!.id,{
     name:selected!.name,cases:verified,expectedRevision:selected!.revision,
    },{workspaceSlug:slug});
   }
   if(scope!==slug+":"+skillId)return;
   setInventory(current=>current.scope===scope?{...current,
    definitions:[updated,...current.definitions.filter(item=>item.id!==updated.id)]}:current);
   setSelectedId(updated.id);
   requestId.current=null;
   setDrawerOpen(false);setEditingId(null);
   setNotice(`Saved case definition to encrypted suite revision ${updated.revision}; no evaluation was executed.`);
  }catch(err){
   setError(err instanceof Error?err.message:
    "Could not save case. Check schema, managed keys, role access, or source revision.");
  }finally{setBusy(false);}
 }
 async function removeCase(item:TestBenchCase){
  if(!editable||!selected||selected.cases.length<=1)return;
  if(!window.confirm(`Remove case ${item.caseId} from suite ${selected.name}?`))return;
  setBusy(true);setError("");
  try{
   const result=await updatePersistedTestBench(skillId,selected.id,{
    name:selected.name,cases:selected.cases.filter(c=>c.caseId!==item.caseId),
    expectedRevision:selected.revision,
   },{workspaceSlug:slug});
   setInventory(current=>current.scope===scope?{...current,
    definitions:[result,...current.definitions.filter(x=>x.id!==result.id)]}:current);
   setSelectedId(result.id);setNotice("Saved a revised suite without that case. No provider run was started.");
  }catch(err){setError(err instanceof Error?err.message:"Remove failed; reload the latest suite revision.");}
  finally{setBusy(false);}
 }
 async function archiveSuite(){
  if(!editable||!selected||!window.confirm(`Archive suite ${selected.name}?`))return;
  setBusy(true);setError("");
  try{
   await archivePersistedTestBench(skillId,selected.id,selected.revision,{workspaceSlug:slug});
   setInventory(current=>current.scope===scope?{...current,
    definitions:current.definitions.filter(x=>x.id!==selected.id)}:current);
   setSelectedId("");setNotice("Suite archived. This did not execute or delete historical results.");
  }catch(err){setError(err instanceof Error?err.message:"Archive failed; verify revision and permissions.");}
  finally{setBusy(false);}
 }

 return <section className={styles.panel} aria-label="Saved test cases and observed outcomes">
  <header className={styles.header}>
   <div><h2>Test cases</h2><p>Versioned encrypted suites. Per-case verdicts appear only when
    a completed, source-pinned provider run returned actual results.</p></div>
   <div className={styles.actions}>
    <button type="button" onClick={()=>setReload(value=>value+1)}
      disabled={busy||inv.loading}>Reload</button>
    <button type="button" onClick={()=>begin(null,true)} disabled={!editable}>+ New suite</button>
    <button type="button" onClick={()=>begin(null)} disabled={!editable||!canAppend}>
      + New Case
    </button>
   </div>
  </header>
  {inv.loading?<p role="status">Loading encrypted, tenant-owned case definitions…</p>:
   inv.error?<TestBenchAvailabilityNotice error={inv.error} pathname={pathname}
     onRetry={()=>setReload(value=>value+1)}/>:
   inv.definitions.length===0?<div className={styles.empty}>
    <h3>No saved Test Bench suites</h3>
    <p>Create a suite to add cases. Indexed benchmark scores from older Git evaluations
      are separate and do not automatically populate encrypted Test Bench cases.</p>
    {editable?<button type="button" onClick={()=>begin(null,true)}>+ New suite with first case</button>:null}
   </div>:<>
    <label className={styles.suitePicker} htmlFor="sv2-test-suite">
      Suite
      <select id="sv2-test-suite" value={activeId} onChange={event=>setSelectedId(event.target.value)}
        disabled={busy}>
        {inv.definitions.map(item=><option value={item.id} key={item.id}>
          {item.name} · revision {item.revision} · {item.cases.length} case(s)</option>)}
      </select>
    </label>
    {selected?<div className={styles.provenance}>
      <span>Git SHA: {selected.sourceCommitSha}</span>
      <span>Saved revision: {selected.revision}</span>
      <button type="button" onClick={()=>void archiveSuite()} disabled={!editable}>Archive suite</button>
    </div>:null}
    {selected?<div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead><tr><th>Case</th><th>Scenario</th><th>Request</th><th>Expected behavior</th>
          <th>Latest observed verdict</th><th>Action</th></tr></thead>
        <tbody>{selected.cases.map((item,index)=>{
          const sample=currentRun?.samples.find(x=>x.caseId===item.caseId);
          return <tr key={item.caseId}>
            <td><strong>Case {index+1}</strong><small>{item.caseId}</small></td>
            <td>{item.kind}</td>
            <td className={styles.ellipsis}>{item.prompt}</td>
            <td className={styles.ellipsis}>{item.expectedBehavior}</td>
            <td>{sample?<><strong>{sample.verdict}</strong>
              <small>Observed · run {currentRun?.id.slice(0,8)}</small></>:
              <span className={styles.muted}>{observed.loading?"Checking…":"Not run for this revision"}</span>}</td>
            <td><div className={styles.actions}>
              <button type="button" onClick={()=>begin(item)} disabled={!editable}>Edit</button>
              <button type="button" onClick={()=>void removeCase(item)}
                disabled={!editable||selected.cases.length<=1}>Remove</button>
            </div></td>
          </tr>;
        })}</tbody>
      </table>
    </div>:null}
    {observed.error?<UiV2StateBanner state="unavailable"
      label={`Observed run results unavailable: ${observed.error}`}/>:null}
    {currentRun?<p className={styles.muted}>Completed run {currentRun.id} ·
      {typeof currentRun.scorecard?.overallScore==="number"?
        ` aggregate score ${currentRun.scorecard.overallScore.toFixed(1)}/100`:
        " aggregate score not provided"}. The API returns per-case verdicts, not independently
      calibrated numeric case scores.</p>:null}
    {selected?<ObservedTestBenchRunPanel key={selected.id+":"+selected.revision}
       skillId={skillId} definition={selected} workspaceSlug={slug} readOnly={readOnly}/>:null}
    {selected?<ObservedRunComparisonPanel skillId={skillId} workspaceSlug={slug}/>:null}
   </>}
  {notice?<p role="status" className={styles.notice}>{notice}</p>:null}
  {error&&!drawerOpen?<p role="alert" className={styles.error}>{error}</p>:null}
  <UiV2InspectorDrawer id="sv2-test-case-edit" title={heading}
    open={drawerOpen} onClose={close}
    actions={<button type="button" disabled={!editable} onClick={()=>void save()}>
      {busy?"Saving…":mode==="edit"?"Save case revision":"Save case"}
    </button>}>
    <div className={styles.form}>
      {mode==="new-suite"?<label>Suite name
        <input value={suiteName} maxLength={100} disabled={busy}
         onChange={event=>setSuiteName(event.target.value)}/>
      </label>:<p className={styles.muted}>Suite: {selected?.name??"Not selected"} ·
        {selected?.sourceCommitSha?.slice(0,12)??"Source not reported"}</p>}
      <label>Scenario
        <select value={form.kind} disabled={busy}
          onChange={event=>setForm(value=>({...value,kind:event.target.value as TestBenchCaseKind}))}>
          {KINDS.map(kind=><option key={kind} value={kind}>{kind}</option>)}
        </select>
      </label>
      <label>User request or test prompt
        <textarea value={form.prompt} maxLength={2000} rows={5} disabled={busy}
          onChange={event=>setForm(value=>({...value,prompt:event.target.value}))}/>
      </label>
      <label>Expected behavior
        <textarea value={form.expectedBehavior} maxLength={1000} rows={4} disabled={busy}
          onChange={event=>setForm(value=>({...value,expectedBehavior:event.target.value}))}/>
      </label>
      <label>Optional safe context
        <textarea value={form.context??""} maxLength={1500} rows={4} disabled={busy}
          onChange={event=>setForm(value=>({...value,context:event.target.value||null}))}/>
      </label>
      <p className={styles.muted}>Saving writes an encrypted, revisioned case definition.
        It does not execute any model, tool or workflow and is subject to server-side access and key readiness.</p>
      {error?<p role="alert" className={styles.error}>{error}</p>:null}
    </div>
  </UiV2InspectorDrawer>
 </section>;
}
