import {withWorkspaceSlugQuery} from "./tenant-paths.ts";
import type {
  ComparableRunMetadata,ObservedComparison,
} from "../server/test-bench/observed-run-comparison.ts";

export class ComparisonClientError extends Error{
  constructor(message:string){super(message);this.name="ComparisonClientError";}
}
type Options={workspaceSlug:string;fetcher?:typeof fetch;signal?:AbortSignal};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new ComparisonClientError("Invalid comparison service response.");
  return value as Record<string,unknown>;
}
function path(skillId:string,opts:Options):string{
  if(typeof skillId!=="string"||!skillId||skillId.length>300||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(opts.workspaceSlug)||
    opts.workspaceSlug.length>80)
    throw new ComparisonClientError("Invalid comparison skill or workspace.");
  return withWorkspaceSlugQuery(
    `/api/skills/${encodeURIComponent(skillId)}/test-bench/compare`,opts.workspaceSlug);
}
export function parseComparisonMetadata(value:unknown):ComparableRunMetadata{
  const o=record(value);
  if(typeof o.id!=="string"||!UUID.test(o.id)||
    typeof o.definitionId!=="string"||!UUID.test(o.definitionId)||
    typeof o.sourceCommitSha!=="string"||!SHA.test(o.sourceCommitSha)||
    typeof o.executionModel!=="string"||!o.executionModel||
    typeof o.judgeModel!=="string"||!o.judgeModel||
    typeof o.completedAt!=="string"||!Number.isFinite(Date.parse(o.completedAt))||
    !Number.isInteger(o.caseCount)||(o.caseCount as number)<1||(o.caseCount as number)>4||
    typeof o.overallScore!=="number"||!Number.isFinite(o.overallScore)||
    o.overallScore<0||o.overallScore>100)
    throw new ComparisonClientError("Invalid run metadata provenance.");
  return o as unknown as ComparableRunMetadata;
}
export function parseObservedComparison(value:unknown,baselineId:string,candidateId:string):
  ObservedComparison{
  const x=record(value);
  if(x.status!=="descriptive_only"||
    !Number.isSafeInteger(x.caseCount)||(x.caseCount as number)<1||
    (x.caseCount as number)>4||
    typeof x.limitations!=="string"||
    !/not statistically significant/i.test(x.limitations))
    throw new ComparisonClientError("A non-descriptive or incomplete comparison was returned.");
  const b=parseComparisonMetadata(x.baseline),c=parseComparisonMetadata(x.candidate);
  if(b.id!==baselineId||c.id!==candidateId||b.sourceCommitSha===c.sourceCommitSha||
    b.executionModel!==c.executionModel||b.judgeModel!==c.judgeModel||
    b.caseCount!==c.caseCount||b.caseCount!==x.caseCount||
    !Array.isArray(x.cases)||x.cases.length!==x.caseCount)
    throw new ComparisonClientError("Run IDs, models or immutable commits do not match.");
  for(const field of ["overallScoreDelta","passRateDeltaPercentagePoints",
    "meanLatencyDeltaMs","estimatedCostDeltaUsd"] as const){
    if(typeof x[field]!=="number"||!Number.isFinite(x[field]))
      throw new ComparisonClientError("Invalid comparison metric.");
  }
  for(const item of x.cases){
    const row=record(item);
    if(typeof row.caseId!=="string"||row.caseId.length>64||
      !["pass","investigate","fail"].includes(row.baselineVerdict as string)||
      !["pass","investigate","fail"].includes(row.candidateVerdict as string)||
      typeof row.qualityDeltaPoints!=="number"||
      !Number.isFinite(row.qualityDeltaPoints)||Math.abs(row.qualityDeltaPoints)>100||
      typeof row.latencyDeltaMs!=="number"||!Number.isFinite(row.latencyDeltaMs))
      throw new ComparisonClientError("Invalid paired case metric.");
  }
  return x as unknown as ObservedComparison;
}
async function load(pathname:string,opts:Options,body?:unknown):Promise<unknown>{
  const response=await (opts.fetcher??fetch)(pathname,{
    method:body===undefined?"GET":"POST",credentials:"same-origin",mode:"same-origin",
    cache:"no-store",headers:{"Accept":"application/json",
      ...(body===undefined?{}:{"Content-Type":"application/json"})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),
    signal:opts.signal??null,
  });
  if(!response.ok)throw new ComparisonClientError(`Comparison refused (HTTP ${response.status}).`);
  try{return record(await response.json()).data;}
  catch{throw new ComparisonClientError("Malformed comparison response.");}
}
export async function listComparableObservedRuns(skillId:string,opts:Options):
  Promise<ComparableRunMetadata[]>{
  const data=await load(path(skillId,opts),opts);
  if(!Array.isArray(data)||data.length>24)
    throw new ComparisonClientError("Invalid comparison history.");
  return data.map(parseComparisonMetadata);
}
export async function compareCompletedObservedRuns(skillId:string,baselineRunId:string,
  candidateRunId:string,opts:Options):Promise<ObservedComparison>{
  const endpoint=path(skillId,opts);
  if(!UUID.test(baselineRunId)||!UUID.test(candidateRunId)||
    baselineRunId===candidateRunId)
    throw new ComparisonClientError("Select two different completed run IDs.");
  const data=await load(endpoint,opts,{baselineRunId,candidateRunId});
  return parseObservedComparison(data,baselineRunId,candidateRunId);
}
