import type { ObservedRunSummary } from "../server/test-bench/observed-run-store.ts";
export type RunsFilter = "all"|"active"|"complete"|"failed"|"canceled";
/** Pure selector: never extrapolates a global run history from a suite-scoped response. */
export function selectObservedRuns(runs:readonly ObservedRunSummary[],query:string,status:RunsFilter) {
  const q=query.trim().toLocaleLowerCase();
  return runs.filter(run=>(!q||run.id.toLocaleLowerCase().includes(q)||
    run.executionSource.toLocaleLowerCase().includes(q))&&(
    status==="all"||
    (status==="active"&&(run.status==="queued"||run.status==="running"))||
    (status==="complete"&&run.status==="complete")||
    (status==="failed"&&run.status==="failed")||
    (status==="canceled"&&run.status==="canceled")));
}
export function runEvidenceStatus(run:ObservedRunSummary) {
  const samples=run.samples;
  const failureCount=samples.filter(s=>s.verdict==="fail").length;
  const investigateCount=samples.filter(s=>s.verdict==="investigate").length;
  return {
    failures:failureCount,investigations:investigateCount,
    score:run.status==="complete"&&run.scorecard&&
      typeof run.scorecard.overallScore==="number"?
      run.scorecard.overallScore:null,
    cost:run.observedUsageReceipts>0?run.estimatedCostUsd:null,
    providerSpendVerified:false, // normalized QA estimate != invoice
    hasStepSpans:false, // server response has no step span contract
  };
}
