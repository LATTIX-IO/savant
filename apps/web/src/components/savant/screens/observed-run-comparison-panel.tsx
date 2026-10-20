"use client";

import {useEffect,useState} from "react";
import {
  compareCompletedObservedRuns,listComparableObservedRuns,
} from "@/lib/observed-run-comparison-client";
import type {
  ComparableRunMetadata,ObservedComparison,
} from "@/server/test-bench/observed-run-comparison";

/** Human-reviewable descriptive QA differences, never automated promotion. */
export function ObservedRunComparisonPanel({
  skillId,workspaceSlug,
}:{skillId:string;workspaceSlug:string}){
  const [runs,setRuns]=useState<ComparableRunMetadata[]>([]);
  const [baselineId,setBaselineId]=useState("");
  const [candidateId,setCandidateId]=useState("");
  const [result,setResult]=useState<ObservedComparison|null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  useEffect(()=>{
    const controller=new AbortController();
    void listComparableObservedRuns(skillId,{workspaceSlug,signal:controller.signal})
      .then(items=>{
        if(controller.signal.aborted)return;
        setRuns(items);
        setBaselineId(items[1]?.id??"");
        setCandidateId(items[0]?.id??"");
        setResult(null);
        setError(null);
      }).catch(()=>{
        if(!controller.signal.aborted)setError("Completed run history could not be loaded.");
      }).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
    return ()=>controller.abort();
  },[skillId,workspaceSlug]);
  const selectedBaseline=runs.find(x=>x.id===baselineId);
  const selectedCandidate=runs.find(x=>x.id===candidateId);
  const canCompare=!busy&&!loading&&!!selectedBaseline&&!!selectedCandidate&&
    selectedBaseline.id!==selectedCandidate.id&&
    selectedBaseline.sourceCommitSha!==selectedCandidate.sourceCommitSha;
  function selectionLabel(run:ComparableRunMetadata):string{
    return `${run.sourceCommitSha.slice(0,10)} · ${run.caseCount} case(s) · score ${run.overallScore.toFixed(1)} · ${new Date(run.completedAt).toLocaleDateString()}`;
  }
  async function compare(){
    if(!canCompare)return;
    setBusy(true);setError(null);setResult(null);
    try{
      const compared=await compareCompletedObservedRuns(skillId,baselineId,candidateId,{
        workspaceSlug,
      });
      setResult(compared);
    }catch{
      setError("These runs cannot be compared. Select two complete evaluations with identical case inputs, models, and scoring contract from different pinned commits.");
    }finally{setBusy(false);}
  }
  return (
    <div role="region" aria-label="Paired Test Bench quality comparison"
      style={{display:"grid",gap:10,borderTop:"1px solid var(--rule)",paddingTop:16}}>
      <strong style={{fontSize:12}}>Baseline vs candidate · observed QA comparison</strong>
      <p className="subtle" style={{fontSize:12,margin:0,lineHeight:1.6}}>
        Compare real chat-only evaluations of the same cases across two immutable skill commits.
        Only complete runs with matching execution model, judge, and scoring contract qualify.
        Results are descriptive, not statistically significant, and never auto-approve a release.
      </p>
      {loading?<p className="subtle">Loading comparable run history…</p>:null}
      {!loading&&runs.length<2?(
        <p className="subtle" style={{fontSize:12,margin:0}}>
          Two complete runs are required. Execute the saved cases at separate Git commits,
          using the same test inputs and provider configuration. Older unversioned scorecards
          must be re-run before comparison.
        </p>
      ):null}
      {runs.length>=2?(
        <div style={{display:"grid",gap:9}}>
          <div className="field">
            <label htmlFor="bench-compare-baseline" className="field-label">Baseline observed run</label>
            <select id="bench-compare-baseline" value={baselineId} disabled={busy}
              onChange={e=>{setBaselineId(e.target.value);setResult(null);}}>
              <option value="">Choose baseline</option>
              {runs.map(run=><option value={run.id} key={run.id}>{selectionLabel(run)}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="bench-compare-candidate" className="field-label">Candidate observed run</label>
            <select id="bench-compare-candidate" value={candidateId} disabled={busy}
              onChange={e=>{setCandidateId(e.target.value);setResult(null);}}>
              <option value="">Choose candidate</option>
              {runs.map(run=><option value={run.id} key={run.id}>{selectionLabel(run)}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-sm btn-primary"
            onClick={()=>void compare()} disabled={!canCompare}>
            {busy?"Comparing stored evidence…":"Compare complete runs"}
          </button>
        </div>
      ):null}
      {error?<p role="alert" style={{fontSize:12,color:"var(--blood)",margin:0}}>{error}</p>:null}
      {result?(
        <div role="status" aria-live="polite" style={{display:"grid",gap:8}}>
          <span className="chip chip-paper">Descriptive only · {result.caseCount} matched cases</span>
          <p style={{fontSize:12,margin:0}}>
            Overall score delta: {result.overallScoreDelta>=0?"+":""}{result.overallScoreDelta.toFixed(2)} points
            {" · "}Pass-rate delta: {result.passRateDeltaPercentagePoints>=0?"+":""}
            {result.passRateDeltaPercentagePoints.toFixed(2)} percentage points
            {" · "}Mean latency delta: {result.meanLatencyDeltaMs>=0?"+":""}
            {result.meanLatencyDeltaMs.toFixed(2)} ms
          </p>
          <span className="mono" style={{fontSize:11,overflowWrap:"anywhere"}}>
            Baseline: {result.baseline.sourceCommitSha}
          </span>
          <span className="mono" style={{fontSize:11,overflowWrap:"anywhere"}}>
            Candidate: {result.candidate.sourceCommitSha}
          </span>
          {result.cases.map(item=>(
            <div key={item.caseId} style={{border:"1px solid var(--rule)",padding:9,
              fontSize:12,overflowWrap:"anywhere"}}>
              {item.caseId}: {item.baselineVerdict} → {item.candidateVerdict}
              {" · "}Quality {item.qualityDeltaPoints>=0?"+":""}{item.qualityDeltaPoints.toFixed(2)} pp
              {" · "}Latency {item.latencyDeltaMs>=0?"+":""}{item.latencyDeltaMs.toFixed(1)} ms
            </div>
          ))}
          <p className="subtle" style={{fontSize:11,margin:0}}>{result.limitations}</p>
        </div>
      ):null}
    </div>
  );
}
