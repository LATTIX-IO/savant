import {DEFAULT_RUBRIC} from "../evaluation/eval-generation.ts";
import {computeScorecard} from "../evaluation/scorecard.ts";
import {TestBenchError,type TestBenchCase} from "./definition-contract.ts";
import {MAX_OBSERVED_CASES,OBSERVED_SCORING_FINGERPRINT,type ObservedCase} from "./observed-evaluator.ts";

export const MAX_COMPARABLE_RUNS=24;
const SHA=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const invalid=():never=>{throw new TestBenchError("test_bench_runs_not_comparable",409);};
export type ComparableObservedRun={
  id:string;organizationId:string;skillId:string;definitionId:string;
  sourceCommitSha:string;definitionRevision:number;status:string;
  expectedCases:number;completedCases:number;cases:readonly TestBenchCase[];
  samples:readonly ObservedCase[];scorecard:Record<string,unknown>|null;
  executionModel:string|null;judgeModel:string|null;completedAt:string|null;
  estimatedCostUsd:number;totalTokens:number;
  executionSource:"platform-nim"|"workspace-openai";
  executionConnectionId:string|null;costAccounting:"platform-estimate"|"normalized-qa-proxy";
};
export type ComparableRunMetadata={
  id:string;definitionId:string;sourceCommitSha:string;
  completedAt:string;executionModel:string;judgeModel:string;
  caseCount:number;overallScore:number;
};
export type ObservedCaseDelta={
  caseId:string;baselineVerdict:ObservedCase["verdict"];
  candidateVerdict:ObservedCase["verdict"];
  qualityDeltaPoints:number;latencyDeltaMs:number;
};
export type ObservedComparison={
  status:"descriptive_only";caseCount:number;
  baseline:ComparableRunMetadata;candidate:ComparableRunMetadata;
  overallScoreDelta:number;passRateDeltaPercentagePoints:number;
  meanLatencyDeltaMs:number;estimatedCostDeltaUsd:number;
  cases:ObservedCaseDelta[];limitations:string;
};
const round=(n:number,digits=2)=>Number(n.toFixed(digits));
function score(value:unknown,max:number):number{
  if(typeof value!=="number"||!Number.isFinite(value)||value<0||value>max)invalid();
  return value as number;
}
function verifyRun(run:ComparableObservedRun):void{
  if(run.status!=="complete"||!SHA.test(run.sourceCommitSha)||
    !run.executionModel||!run.judgeModel||!run.completedAt||
    !Number.isFinite(Date.parse(run.completedAt))||
    !Array.isArray(run.cases)||!Array.isArray(run.samples)||
    run.cases.length<1||run.cases.length>MAX_OBSERVED_CASES||
    run.cases.length!==run.expectedCases||run.samples.length!==run.completedCases||
    run.completedCases!==run.expectedCases||
    !Number.isSafeInteger(run.totalTokens)||run.totalTokens<1||
    !Number.isFinite(run.estimatedCostUsd)||run.estimatedCostUsd<0)
    invalid();
  const recorded=run.scorecard;
  if(!recorded||recorded.scoringContract!==OBSERVED_SCORING_FINGERPRINT)
    return invalid();
  for(const [index,item] of run.cases.entries()){
    const sample=run.samples[index];
    if(!sample)return invalid();
    if(sample.caseId!==item.caseId||sample.kind!==item.kind||
      sample.prompt!==item.prompt||sample.executionModel!==run.executionModel||
      sample.judgeModel!==run.judgeModel||
      !["pass","investigate","fail"].includes(sample.verdict)||
      typeof sample.output!=="string"||sample.output.length>2000||
      typeof sample.policyCompliance!=="boolean"||
      typeof sample.groundingRelevant!=="boolean"||
      !Number.isSafeInteger(sample.humanRevisionCount)||sample.humanRevisionCount<0||
      sample.humanRevisionCount>3)invalid();
    for(const field of ["quality","formatCompliance","groundingScore","actionability","expectedMet"] as const)
      score(sample[field],1);
    score(sample.latencyMs,300_000);
    score(sample.estimatedCostUsd,0.05);
  }
  const computed=computeScorecard([...run.samples],DEFAULT_RUBRIC);
  for(const field of [
    "overallScore","qualityScore","complianceScore","groundingScore",
    "actionabilityScore","efficiencyScore","passRate","investigateRate","failRate",
    "avgLatencyMs","avgEstimatedCostUsd",
  ] as const){
    const actual=score(recorded[field],field.endsWith("Rate")?1:field==="avgLatencyMs"?300_000:100);
    if(Math.abs(actual-computed[field])>0.011)invalid();
  }
  if(recorded.sampleCount!==run.expectedCases||
    recorded.passCount!==computed.passCount||
    recorded.failCount!==computed.failCount||
    recorded.investigateCount!==computed.investigateCount)invalid();
}
function meta(run:ComparableObservedRun):ComparableRunMetadata{
  return {
    id:run.id,definitionId:run.definitionId,sourceCommitSha:run.sourceCommitSha,
    completedAt:run.completedAt!,executionModel:run.executionModel!,
    judgeModel:run.judgeModel!,caseCount:run.expectedCases,
    overallScore:run.scorecard!.overallScore as number,
  };
}
/** Read-only deterministic comparison of REAL, identical-case, same-model,
 * same-rubric scorecards from two distinct immutable Git source revisions.
 * Never returns prompts, outputs or an inferential statistical claim.
 */
export function compareObservedRuns(
 baseline:ComparableObservedRun,candidate:ComparableObservedRun,
):ObservedComparison{
  verifyRun(baseline);verifyRun(candidate);
  if(!baseline.organizationId||baseline.organizationId!==candidate.organizationId||
    !baseline.skillId||baseline.skillId!==candidate.skillId||
    baseline.id===candidate.id||baseline.sourceCommitSha===candidate.sourceCommitSha||
    baseline.executionModel!==candidate.executionModel||
    baseline.executionSource!==candidate.executionSource||
    baseline.costAccounting!==candidate.costAccounting||
    baseline.executionConnectionId!==candidate.executionConnectionId||
    baseline.judgeModel!==candidate.judgeModel||
    baseline.cases.length!==candidate.cases.length||
    JSON.stringify(baseline.cases)!==JSON.stringify(candidate.cases))
    invalid();
  const b=baseline.scorecard!,c=candidate.scorecard!;
  const cases=baseline.samples.map((sample,index):ObservedCaseDelta=>{
    const next=candidate.samples[index]!;
    if(sample.caseId!==next.caseId)invalid();
    return {
      caseId:sample.caseId,
      baselineVerdict:sample.verdict,candidateVerdict:next.verdict,
      qualityDeltaPoints:round((next.quality-sample.quality)*100),
      latencyDeltaMs:round(next.latencyMs-sample.latencyMs),
    };
  });
  return {
    status:"descriptive_only",caseCount:cases.length,
    baseline:meta(baseline),candidate:meta(candidate),
    overallScoreDelta:round((c.overallScore as number)-(b.overallScore as number)),
    passRateDeltaPercentagePoints:round(
      ((c.passRate as number)-(b.passRate as number))*100),
    meanLatencyDeltaMs:round(
      (c.avgLatencyMs as number)-(b.avgLatencyMs as number)),
    estimatedCostDeltaUsd:round(candidate.estimatedCostUsd-baseline.estimatedCostUsd,6),
    cases,
    limitations:"Descriptive differences across at most four chat-only paired cases. Not statistically significant, not proof of external harness or tool execution, and not release authorization.",
  };
}
