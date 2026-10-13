import {withWorkspaceSlugQuery} from "./tenant-paths.ts";
import type {ObservedRunSummary} from "../server/test-bench/observed-run-store.ts";

export class ObservedRunClientError extends Error{
  constructor(message:string){super(message);this.name="ObservedRunClientError";}
}
export type ObservedClientOptions={workspaceSlug:string;fetcher?:typeof fetch;signal?:AbortSignal};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const STATUSES=new Set(["queued","running","complete","failed","canceled"]);
function record(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new ObservedRunClientError("Invalid observed Test Bench response.");
  return value as Record<string,unknown>;
}
function path(skillId:string,definitionId:string,options:ObservedClientOptions):string{
  if(!skillId||skillId.length>300||!UUID.test(definitionId)||
    typeof options.workspaceSlug!=="string"||options.workspaceSlug.length>80||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(options.workspaceSlug))
    throw new ObservedRunClientError("A valid workspace and suite are required.");
  return withWorkspaceSlugQuery(
    `/api/skills/${encodeURIComponent(skillId)}/test-bench/${encodeURIComponent(definitionId)}/runs`,
    options.workspaceSlug,
  );
}
export function parseObservedRun(value:unknown,skillId:string,definitionId:string,sourceCommitSha:string):ObservedRunSummary{
  const x=record(value);
  if(typeof x.id!=="string"||!UUID.test(x.id)||
    x.definitionId!==definitionId||x.skillId!==skillId||
    typeof x.sourceCommitSha!=="string"||!SHA.test(x.sourceCommitSha)||
    x.sourceCommitSha!==sourceCommitSha||!STATUSES.has(x.status as string)||
    !Number.isSafeInteger(x.expectedCases)||(x.expectedCases as number)<1||
    (x.expectedCases as number)>4||!Number.isSafeInteger(x.completedCases)||
    (x.completedCases as number)<0||
    (x.completedCases as number)>(x.expectedCases as number)||
    !Number.isSafeInteger(x.definitionRevision)||(x.definitionRevision as number)<1||
    !Array.isArray(x.samples)||x.samples.length!==(x.completedCases as number)||
    !Number.isSafeInteger(x.observedExecutorTokens)||
    !Number.isSafeInteger(x.observedJudgeTokens)||
    !Number.isSafeInteger(x.observedUsageReceipts)||
    (x.observedExecutorTokens as number)<0||
    (x.observedJudgeTokens as number)<0||
    (x.observedUsageReceipts as number)<0||
    (x.observedExecutorTokens as number)>4000000||
    (x.observedJudgeTokens as number)>4000000||
    (x.observedUsageReceipts as number)>8||
    ((x.observedExecutorTokens as number)+(x.observedJudgeTokens as number)===0)
      !==((x.observedUsageReceipts as number)===0)||
    !Number.isSafeInteger(x.totalTokens)||(x.totalTokens as number)<0||
    typeof x.estimatedCostUsd!=="number"||!Number.isFinite(x.estimatedCostUsd)||
    x.estimatedCostUsd<0||x.estimatedCostUsd>0.05||
    !["platform-nim","workspace-openai"].includes(x.executionSource as string)||
    !["platform-estimate","normalized-qa-proxy"].includes(x.costAccounting as string)||
    (x.executionSource==="workspace-openai"&&(
      x.costAccounting!=="normalized-qa-proxy"||
      typeof x.executionModelPinned!=="string"||!x.executionModelPinned))||
    (x.executionSource==="platform-nim"&&x.costAccounting!=="platform-estimate")||
    typeof x.createdAt!=="string"||typeof x.updatedAt!=="string")
    throw new ObservedRunClientError("Invalid observed Test Bench identity or provenance.");
  if(x.status==="complete"&&(x.completedCases!==x.expectedCases||
    !x.scorecard||typeof x.scorecard!=="object"||Array.isArray(x.scorecard)))
    throw new ObservedRunClientError("Incomplete observed case evidence.");
  if(x.status!=="complete"&&x.scorecard!==null)
    throw new ObservedRunClientError("Incomplete runs cannot carry scored release evidence.");
  if(x.status==="canceled"&&(
    typeof x.canceledAt!=="string"||!Number.isFinite(Date.parse(x.canceledAt))||
    typeof x.canceledBy!=="string"||x.canceledBy.length<1))
    throw new ObservedRunClientError("Canceled run lacks terminal audit provenance.");
  for(const result of x.samples){
    const s=record(result);
    if(typeof s.caseId!=="string"||typeof s.output!=="string"||
      s.output.length>2000||!["pass","investigate","fail"].includes(s.verdict as string)||
      typeof s.latencyMs!=="number"||!Number.isFinite(s.latencyMs)||
      s.latencyMs<0)
      throw new ObservedRunClientError("Invalid observed per-case evidence.");
  }
  return x as unknown as ObservedRunSummary;
}
async function fetchJson(uri:string,method:"GET"|"POST",opts:ObservedClientOptions,payload?:unknown):
 Promise<{data:unknown;status:number}>{
  const response=await (opts.fetcher??fetch)(uri,{
    method,mode:"same-origin",credentials:"same-origin",cache:"no-store",
    headers:{"Accept":"application/json",...(payload===undefined?{}:{"Content-Type":"application/json"})},
    ...(payload===undefined?{}:{body:JSON.stringify(payload)}),
    signal:opts.signal??null,
  });
  if(!response.ok)
    throw new ObservedRunClientError(`Observed test execution was refused (HTTP ${response.status}).`);
  try{return {data:record(await response.json()).data,status:response.status};}
  catch{throw new ObservedRunClientError("Malformed observed execution response.");}
}
export async function listObservedTestBenchRuns(
  skillId:string,definitionId:string,commitSha:string,options:ObservedClientOptions,
):Promise<ObservedRunSummary[]>{
  const response=await fetchJson(path(skillId,definitionId,options),"GET",options);
  if(!Array.isArray(response.data)||response.data.length>15)
    throw new ObservedRunClientError("Invalid observed run history.");
  return response.data.map(v=>parseObservedRun(v,skillId,definitionId,commitSha));
}
export async function startObservedTestBenchRun(
  skillId:string,definitionId:string,commitSha:string,
  input:{requestId:string;expectedRevision:number;executionSource?:"platform-nim"|"workspace-openai"},
  options:ObservedClientOptions,
):Promise<ObservedRunSummary>{
  const response=await fetchJson(path(skillId,definitionId,options),"POST",options,input);
  if(response.status!==202&&response.status!==200)
    throw new ObservedRunClientError("The observed run was not accepted.");
  return parseObservedRun(response.data,skillId,definitionId,commitSha);
}

/** Cancellation is an exact-run, exact-revision, same-origin mutation.
 * It never embeds provider credentials, raw prompts or a client-selected actor.
 */
export async function cancelObservedTestBenchRun(
  skillId:string,definitionId:string,commitSha:string,runId:string,
  expectedRevision:number,options:ObservedClientOptions,
):Promise<ObservedRunSummary>{
  const base=path(skillId,definitionId,options);
  if(!UUID.test(runId)||!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
    throw new ObservedRunClientError("Invalid cancellation target.");
  const endpoint=base.replace("/runs?","/runs/"+encodeURIComponent(runId)+"/cancel?");
  if(endpoint===base)throw new ObservedRunClientError("Invalid cancellation path.");
  const response=await fetchJson(endpoint,"POST",options,{expectedRevision});
  if(response.status!==200&&response.status!==202)
    throw new ObservedRunClientError("Cancellation was not acknowledged.");
  const result=parseObservedRun(response.data,skillId,definitionId,commitSha);
  if(result.id!==runId||result.definitionRevision!==expectedRevision||result.status!=="canceled")
    throw new ObservedRunClientError("Cancellation did not match the requested run.");
  return result;
}
