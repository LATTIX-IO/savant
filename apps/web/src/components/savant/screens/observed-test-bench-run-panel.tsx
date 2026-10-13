"use client";

import {useEffect,useRef,useState} from "react";
import {
  listObservedTestBenchRuns,startObservedTestBenchRun,cancelObservedTestBenchRun,
} from "@/lib/observed-test-bench-runs";
import type {ObservedRunSummary} from "@/server/test-bench/observed-run-store";
import type {TestBenchDefinition} from "@/server/test-bench/definition-contract";
import {readObservedDailyQuota} from "@/lib/observed-admission-quota-client";
import type {DailyAdmissionQuota} from "@/server/test-bench/observed-admission-quota";

/** Displays ONLY server-confirmed NIM/Jev chat-only observations, never synthetic scores. */
export function ObservedTestBenchRunPanel({
  skillId,definition,workspaceSlug,readOnly,
}:{
  skillId:string;definition:TestBenchDefinition;workspaceSlug:string;readOnly:boolean;
}){
  const [runs,setRuns]=useState<ObservedRunSummary[]>([]);
  const [loading,setLoading]=useState(true);
  const [starting,setStarting]=useState(false);
  const [executionSource,setExecutionSource]=useState<"platform-nim"|"workspace-openai">("workspace-openai");
  const [canceling,setCanceling]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [dailyQuota,setDailyQuota]=useState<DailyAdmissionQuota|null>(null);
  const [quotaUnavailable,setQuotaUnavailable]=useState(false);
  const requestId=useRef<string|null>(null);
  const latest=runs[0]??null;
  const active=runs.some(run=>run.status==="queued"||run.status==="running");
  const canRun=!readOnly&&definition.cases.length<=4&&!active&&!starting&&!canceling&&
    (dailyQuota?.remainingRuns??1)>0;
  const canCancel=!readOnly&&!!latest&&active&&!starting&&!canceling;

  useEffect(()=>{
    const controller=new AbortController();
    void readObservedDailyQuota(workspaceSlug,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted){setDailyQuota(value);setQuotaUnavailable(false);}})
      .catch(()=>{if(!controller.signal.aborted)setQuotaUnavailable(true);});
    return ()=>controller.abort();
  },[workspaceSlug]);

  useEffect(()=>{
    const controller=new AbortController();
    void listObservedTestBenchRuns(skillId,definition.id,definition.sourceCommitSha,{
      workspaceSlug,signal:controller.signal,
    }).then(value=>{
      if(!controller.signal.aborted){setRuns(value);setError(null);}
    }).catch(()=>{
      if(!controller.signal.aborted)setError("Unable to load persisted observed runs.");
    }).finally(()=>{
      if(!controller.signal.aborted)setLoading(false);
    });
    return ()=>controller.abort();
  },[skillId,definition.id,definition.sourceCommitSha,definition.revision,workspaceSlug]);

  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();
    let busy=false;
    const interval=window.setInterval(()=>{
      if(busy)return;
      busy=true;
      void listObservedTestBenchRuns(skillId,definition.id,definition.sourceCommitSha,{
        workspaceSlug,signal:controller.signal,
      }).then(value=>{
        if(!controller.signal.aborted){setRuns(value);setError(null);}
      }).catch(()=>{
        if(!controller.signal.aborted)setError("Observed run status refresh failed.");
      }).finally(()=>{busy=false;});
    },5_000);
    return ()=>{window.clearInterval(interval);controller.abort();};
  },[active,skillId,definition.id,definition.sourceCommitSha,workspaceSlug]);

  async function run(){
    if(!canRun)return;
    setStarting(true);setError(null);
    try{
      const accepted=await startObservedTestBenchRun(
        skillId,definition.id,definition.sourceCommitSha,{
          requestId:requestId.current??(requestId.current=crypto.randomUUID()),
          expectedRevision:definition.revision,executionSource,
        },{workspaceSlug},
      );
      requestId.current=null;
      setRuns(current=>[accepted,...current.filter(x=>x.id!==accepted.id)].slice(0,15));
      void readObservedDailyQuota(workspaceSlug)
        .then(value=>{setDailyQuota(value);setQuotaUnavailable(false);})
        .catch(()=>{setQuotaUnavailable(true);});
    }catch{
      // Retain the request ID: a retry can safely reconcile an ambiguous 202.
      setError("Live execution was not accepted or confirmed. Check provider access, the case limit, revision or workspace permissions.");
    }finally{setStarting(false);}
  }
  async function cancel(){
    if(!latest||!canCancel)return;
    setCanceling(true);setError(null);
    try{
      const terminal=await cancelObservedTestBenchRun(
        skillId,definition.id,definition.sourceCommitSha,latest.id,
        latest.definitionRevision,{workspaceSlug},
      );
      setRuns(current=>[terminal,...current.filter(x=>x.id!==terminal.id)].slice(0,15));
    }catch{
      setError("Cancellation was not confirmed. Reload the run; an in-flight provider request may still complete.");
    }finally{setCanceling(false);}
  }
  const overall=latest?.status==="complete"&&latest.scorecard&&
    typeof latest.scorecard.overallScore==="number"?
    latest.scorecard.overallScore:null;
  return (
    <div style={{display:"grid",gap:10,borderTop:"1px solid var(--rule)",paddingTop:14}}>
      <div className="row" style={{alignItems:"center",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
        <strong style={{fontSize:12}}>Observed chat-only execution</strong>
        <span className="chip chip-paper">Provider-backed · not harness/tool verification</span>
      </div>
      <p className="subtle" style={{fontSize:12,margin:0,lineHeight:1.5}}>
        Run the saved revision with either an explicitly configured workspace OpenAI key
        or Savant platform NIM. Both modes use Savant Jev for judging.
        Up to four cases per run. This does not execute MCP tools, scripts or customer-owned harnesses.
        Results are provisional and do not constitute an automatic release approval.
        Workspace OpenAI uses the tenant-provided key with a token bound, but actual
        provider charges are not capped by the normalized QA cost proxy.
        Cancellation stops subsequent provider calls once observed; it cannot guarantee
        interruption or reimbursement for an inference request already in flight.
      </p>
      {dailyQuota?(
        <p className="subtle" style={{fontSize:12,margin:0}}>
          UTC daily Test Bench admissions: {dailyQuota.remainingRuns} of {dailyQuota.dailyRunLimit}
          {" "}remaining · resets {new Date(dailyQuota.resetAtUtc).toLocaleString()}.
          Each accepted run reserves 12,000 normalized QA units; cancellation and failure
          do not restore today&apos;s allowance. This is not a provider spend cap.
        </p>
      ):quotaUnavailable?(
        <p className="subtle" style={{fontSize:12,margin:0}}>
          Tenant admission quota could not be read. Execution is still checked by the server.
        </p>
      ):null}
      {definition.cases.length>4?(
        <p className="subtle" style={{fontSize:12,margin:0}}>
          This suite contains {definition.cases.length} cases. The current bounded executor supports
          at most four; split the suite before running it.
        </p>
      ):null}
      <div className="field">
        <label className="field-label" htmlFor="observed-provider-source">Execution provider</label>
        <select id="observed-provider-source" value={executionSource}
          disabled={starting||active||loading||readOnly}
          onChange={e=>setExecutionSource(e.target.value as "platform-nim"|"workspace-openai")}>
          <option value="workspace-openai">Workspace default OpenAI (tenant key)</option>
          <option value="platform-nim">Savant NVIDIA NIM (platform key)</option>
        </select>
      </div>
      <div className="row" style={{gap:8,flexWrap:"wrap"}}>
        <button type="button" className="btn btn-sm btn-primary" disabled={!canRun||loading}
          onClick={()=>void run()}>
          {starting?"Requesting execution…":active?"Run in progress":dailyQuota?.remainingRuns===0?"Daily quota reached":executionSource==="workspace-openai"?"Run with workspace OpenAI":"Run with Savant NIM"}
        </button>
        {latest&&(latest.status==="queued"||latest.status==="running")?(
          <button type="button" className="btn btn-sm btn-ghost"
            disabled={!canCancel} onClick={()=>void cancel()}>
            {canceling?"Canceling…":"Cancel run"}
          </button>
        ):null}
        {loading?<span className="subtle">Reading persisted runs…</span>:null}
      </div>
      {error?<p role="alert" style={{fontSize:12,color:"var(--blood)",margin:0}}>{error}</p>:null}
      {latest?(
        <div role="status" aria-live="polite" style={{display:"grid",gap:7}}>
          <div className="row" style={{alignItems:"center",justifyContent:"space-between"}}>
            <strong style={{fontSize:12}}>Latest observed run</strong>
            <span className="chip chip-paper">{latest.status}</span>
          </div>
          <span className="mono" style={{fontSize:11,overflowWrap:"anywhere"}}>
            {latest.id} · {latest.completedCases}/{latest.expectedCases} observed cases ·
            {" "}{latest.executionSource==="workspace-openai"?"Workspace OpenAI":"Savant NIM"}
          </span>
          {latest.status==="canceled"?(
            <p className="subtle" style={{fontSize:12,margin:0}}>
              Run canceled. {latest.completedCases} case(s) were observed before cancellation;
              there is no aggregate score. In-flight provider charges may still apply.
            </p>
          ):null}
          {latest.status==="failed"?(
            <p className="subtle" style={{fontSize:12,margin:0}}>
              The run failed. Only {latest.completedCases} case(s) were observed; there is no aggregate score.
              {latest.errorCode?` Diagnostic: ${latest.errorCode}`:""}
            </p>
          ):null}
          {overall!==null?(
            <p style={{fontSize:12,margin:0}}>
              Provisional complete-case score: {overall.toFixed(1)}/100 · {" "}
              {latest.costAccounting==="normalized-qa-proxy"?
                "normalized QA cost proxy (not actual provider spend):":"platform estimated model cost:"}
              {" "}${latest.estimatedCostUsd.toFixed(6)} USD-equivalent
            </p>
          ):null}
          {latest.samples.map(sample=>(
            <div key={sample.caseId}
              style={{padding:10,border:"1px solid var(--rule)",display:"grid",gap:5}}>
              <span style={{fontSize:12}}>
                {sample.caseId} · {sample.verdict} · observed response {sample.latencyMs}ms
              </span>
              <div style={{fontSize:11,color:"var(--ink-2)",whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>
                {sample.output}
              </div>
            </div>
          ))}
        </div>
      ):(!loading?<p className="subtle" style={{fontSize:12,margin:0}}>
        No recorded execution yet. Saving a case suite does not create a test result.
      </p>:null)}
    </div>
  );
}
