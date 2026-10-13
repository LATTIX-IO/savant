import type {GitActor} from "../git/access-control.ts";
import {assertGitPermission} from "../git/access-control.ts";
import {decryptTestBenchCases} from "./definition-crypto.ts";
import {parseTestBenchCases,TestBenchError} from "./definition-contract.ts";
import {OBSERVED_SCORING_FINGERPRINT,type ObservedCase} from "./observed-evaluator.ts";
import {
  MAX_COMPARABLE_RUNS,compareObservedRuns,
  type ComparableObservedRun,type ComparableRunMetadata,type ObservedComparison,
} from "./observed-run-comparison.ts";

type Sql=import("postgres").Sql;
type DbRow={
  id:string;organization_id:string;skill_id:string;definition_id:string;
  source_commit_sha:string;definition_revision:number;status:string;
  expected_cases:number;completed_cases:number;
  snapshot_ciphertext:string;results_ciphertext:string|null;
  scorecard:Record<string,unknown>|null;execution_model:string|null;
  judge_model:string|null;total_tokens:number;estimated_cost_usd:string|number;
  completed_at:Date|string|null;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function notFound():never{
  throw new TestBenchError("test_bench_comparison_unavailable",404);
}
function authorize(actor:GitActor,skillId:string):void{
  if(!actor.organizationId||!actor.subject)throw new TestBenchError("auth_required",401);
  assertGitPermission(actor,"view");
  if(!skillId||skillId.length>300)notFound();
}
const toIso=(v:Date|string|null):string|null=>v?
  v instanceof Date?v.toISOString():new Date(v).toISOString():null;
function toMetadata(row:DbRow):ComparableRunMetadata{
  return {
    id:row.id,definitionId:row.definition_id,sourceCommitSha:row.source_commit_sha,
    executionModel:row.execution_model!,judgeModel:row.judge_model!,
    completedAt:toIso(row.completed_at)!,
    caseCount:row.expected_cases,overallScore:row.scorecard!.overallScore as number,
  };
}
function decode(row:DbRow):ComparableObservedRun{
  if(!row.results_ciphertext||!row.scorecard)
    throw new TestBenchError("test_bench_comparison_evidence_invalid",503);
  const ctx={
    organizationId:row.organization_id,definitionId:row.id,
    revision:row.definition_revision,commitSha:row.source_commit_sha,
  };
  let cases:ReturnType<typeof parseTestBenchCases>,samples:unknown;
  try{
    cases=parseTestBenchCases(JSON.parse(decryptTestBenchCases(
      row.snapshot_ciphertext,ctx)) as unknown);
    samples=JSON.parse(decryptTestBenchCases(
      row.results_ciphertext,ctx,process.env,65536)) as unknown;
  }catch(error){
    if(error instanceof TestBenchError&&error.code==="test_bench_key_unconfigured")throw error;
    throw new TestBenchError("test_bench_comparison_evidence_invalid",503);
  }
  return {
    id:row.id,organizationId:row.organization_id,skillId:row.skill_id,
    definitionId:row.definition_id,sourceCommitSha:row.source_commit_sha,
    definitionRevision:row.definition_revision,status:row.status,
    expectedCases:row.expected_cases,completedCases:row.completed_cases,
    cases,samples:samples as ObservedCase[],scorecard:row.scorecard,
    executionModel:row.execution_model,judgeModel:row.judge_model,
    completedAt:toIso(row.completed_at),estimatedCostUsd:Number(row.estimated_cost_usd),
    totalTokens:row.total_tokens,
  };
}
export function createObservedComparisonStore(sql:Sql){
  return {
    /** Bounded, metadata-only selector; no prompt/output or foreign tenant data. */
    async list(actor:GitActor,skillId:string):Promise<ComparableRunMetadata[]>{
      authorize(actor,skillId);
      const rows=await sql<DbRow[]>`
        select id,organization_id,skill_id,definition_id,source_commit_sha,
          definition_revision,status,expected_cases,completed_cases,
          scorecard,execution_model,judge_model,completed_at
        from test_bench_runs
        where organization_id=${actor.organizationId} and skill_id=${skillId}
          and status='complete' and scorecard->>'scoringContract'=${OBSERVED_SCORING_FINGERPRINT}
        order by completed_at desc limit ${MAX_COMPARABLE_RUNS}
      `;
      return rows.filter(row=>row.execution_model&&row.judge_model&&
        row.completed_at&&row.expected_cases===row.completed_cases&&
        Number.isFinite(row.scorecard?.overallScore)&&
        Number(row.scorecard?.overallScore)>=0&&Number(row.scorecard?.overallScore)<=100
      ).map(toMetadata);
    },
    /** Same-skill/tenant comparisons only. A foreign or absent run returns the
     * same generic 404, with no timing-sensitive discovery endpoint.
     */
    async compare(actor:GitActor,skillId:string,baselineId:string,candidateId:string):
      Promise<ObservedComparison>{
      authorize(actor,skillId);
      if(!UUID.test(baselineId)||!UUID.test(candidateId)||
        baselineId.toLowerCase()===candidateId.toLowerCase())
        throw new TestBenchError("test_bench_comparison_request_invalid",422);
      const rows=await sql<DbRow[]>`
        select * from test_bench_runs
        where organization_id=${actor.organizationId} and skill_id=${skillId}
          and id in (${baselineId},${candidateId}) and status='complete'
        limit 2
      `;
      const byId=new Map(rows.map(row=>[row.id,row]));
      const baseline=byId.get(baselineId.toLowerCase());
      const candidate=byId.get(candidateId.toLowerCase());
      if(!baseline||!candidate)return notFound();
      return compareObservedRuns(decode(baseline),decode(candidate));
    },
  };
}
