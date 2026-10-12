"use client";

import {useEffect,useState} from "react";

import {
  isActiveLiveEvaluation,loadLiveEvalAutomation,startLiveEvalAutomation,
  type LiveEvalAutomation,type LiveEvalRun,
} from "@/lib/live-evaluation-automation";

const POLL_INTERVAL_MS=6000;

/** Server-backed generation and scoring. Does not execute arbitrary harness tools. */
export function LiveEvaluationAutomation({
  skillId,readOnly,
}: {skillId:string;readOnly:boolean}) {
  const [snapshot,setSnapshot]=useState<LiveEvalAutomation|null>(null);
  const [loading,setLoading]=useState(true);
  const [submitting,setSubmitting]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [latestRequestedId,setLatestRequestedId]=useState<string|null>(null);
  const focused=snapshot?.runs.find(run=>run.id===latestRequestedId)??snapshot?.runs[0]??null;
  const active=focused!==null&&isActiveLiveEvaluation(focused.status);

  useEffect(()=>{
    const controller=new AbortController();
    void loadLiveEvalAutomation(skillId,{signal:controller.signal})
      .then(value=>{if(!controller.signal.aborted)setSnapshot(value);})
      .catch(()=>{if(!controller.signal.aborted)setError("Unable to read the persisted evaluation status.");})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[skillId]);

  useEffect(()=>{
    if(!active)return;
    const controller=new AbortController();
    let reading=false;
    const interval=window.setInterval(()=>{
      if(reading)return;
      reading=true;
      void loadLiveEvalAutomation(skillId,{signal:controller.signal})
        .then(value=>{if(!controller.signal.aborted){setSnapshot(value);setError(null);}})
        .catch(()=>{if(!controller.signal.aborted)setError("Unable to refresh evaluation status.");})
        .finally(()=>{reading=false;});
    },POLL_INTERVAL_MS);
    return ()=>{window.clearInterval(interval);controller.abort();};
  },[active,skillId]);

  async function start(){
    if(readOnly||submitting||!snapshot?.canGenerate||active)return;
    setSubmitting(true);
    setError(null);
    try {
      const accepted=await startLiveEvalAutomation(skillId);
      setLatestRequestedId(accepted.id);
      setSnapshot(current=>current===null?null:{
        ...current,
        runs:[accepted,...current.runs.filter(run=>run.id!==accepted.id)].slice(0,5),
      });
    } catch {
      setError("The server did not accept this evaluation. Check provider configuration, permissions and repository sync.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel" aria-label="Live evaluation generation">
      <div className="panel-hd">
        <div>
          <div className="panel-title">Server-backed evaluation</div>
          <div className="subtle" style={{fontSize:11.5}}>
            Generate and score a real chat-only skill evaluation against a persisted Git revision.
          </div>
        </div>
        <span className="chip chip-paper">Persisted run</span>
      </div>
      <div className="panel-bd" style={{display:"grid",gap:12}}>
        <div style={{fontSize:12,color:"var(--ink-2)",lineHeight:1.55}}>
          This uses configured NVIDIA NIM and Jev services. It does not execute external harnesses,
          scripts, MCP tools or saved Test Bench drafts. Results are provisional until reviewed.
        </div>
        <div className="row" style={{alignItems:"center",gap:10,flexWrap:"wrap"}}>
          <button
            type="button" className="btn btn-primary" onClick={()=>void start()}
            disabled={readOnly||loading||submitting||active||!snapshot?.canGenerate}
          >
            {submitting?"Submitting…":active?"Evaluation in progress":"Generate live evaluation"}
          </button>
          {loading?<span className="subtle">Checking evaluation service…</span>:null}
          {snapshot&&!snapshot.canGenerate?(
            <span className="subtle" style={{fontSize:12}}>
              Live evaluation requires an authorized role and configured NIM/Jev services.
            </span>
          ):null}
          {readOnly?<span className="subtle">Historical evaluation is read-only.</span>:null}
        </div>
        {error?<p role="alert" style={{color:"var(--blood)",fontSize:12,margin:0}}>{error}</p>:null}
        {focused?(
          <div role="status" aria-live="polite" style={{borderTop:"1px solid var(--rule)",paddingTop:12,display:"grid",gap:6}}>
            <div className="row" style={{justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
              <strong style={{fontSize:12}}>Latest persisted evaluation</strong>
              <span className={focused.status==="failed"?"chip chip-blood":active?"chip chip-brass":"chip chip-paper"}>
                {focused.status.replace("_"," ")}
              </span>
            </div>
            <span className="mono" style={{fontSize:11,color:"var(--ink-3)",overflowWrap:"anywhere"}}>
              Run {focused.id}
            </span>
            {focused.commitSha?(
              <span className="mono" style={{fontSize:11,color:"var(--ink-3)",overflowWrap:"anywhere"}}>
                Evaluated commit: {focused.commitSha}
              </span>
            ):(
              <span style={{fontSize:12,color:"var(--blood)"}}>
                Source revision unverified. This run cannot be used as provenance evidence.
              </span>
            )}
            {focused.score!==null?(
              <span style={{fontSize:12}}>Provisional rubric score: {focused.score.toFixed(1)}/100</span>
            ):null}
            {focused.status==="needs_review"?(
              <span style={{fontSize:12}}>Human review is required before treating the generated score as a baseline.</span>
            ):null}
            {focused.error?<span role="alert" style={{fontSize:12}}>{focused.error}</span>:null}
          </div>
        ):(!loading&&snapshot)?(
          <div className="subtle" style={{fontSize:12}}>No persisted evaluation-generation runs found for this skill.</div>
        ):null}
      </div>
    </section>
  );
}
