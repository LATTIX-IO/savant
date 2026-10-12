import {AiServiceError,createJevClient,createNimChatClient,
  readAiServiceConfig,type ChatClient,type JudgeClient} from "../ai/clients.ts";
import type {GitRuntime} from "../git/runtime.ts";
import {openRepositoryFiles} from "../jobs/repository-files.ts";
import type {BackgroundJob,JobQueue} from "../jobs/queue.ts";
import {TestBenchError} from "./definition-contract.ts";
import {MAX_SKILL_INSTRUCTIONS_BYTES,ObservedEvaluationError,executeObservedCases} from "./observed-evaluator.ts";
import {createObservedRunStore} from "./observed-run-store.ts";

type Sql=import("postgres").Sql;
function safeFailure(error:unknown):string{
  if(error instanceof ObservedEvaluationError)return error.code;
  if(error instanceof TestBenchError&&error.code.startsWith("test_bench_"))return error.code;
  if(error instanceof AiServiceError)return "test_bench_provider_execution_failed";
  return "test_bench_provider_execution_failed";
}
type Dependencies={
  sql:Sql;job:BackgroundJob;queue:Pick<JobQueue,"release">;deadline:number;
  readInstructions:(organizationId:string,repositoryId:string,sourcePath:string,commitSha:string)=>Promise<string|null>;
  clients:()=>{executor:ChatClient;judge:JudgeClient}|null;
};
/**
 * A retry after provider I/O may double-bill or give a different answer.
 * First lease only: subsequent claims mark the run failed, never re-run the model.
 * The database is authoritative for run status and encrypted per-case progress.
 */
export async function executeQueuedObservedRun(deps:Dependencies):Promise<"done"|"released">{
  const {sql,job,queue}=deps;
  if(!job.organizationId||!job.repositoryId||
    typeof job.payload.runId!=="string"||
    !/^[0-9a-f-]{36}$/i.test(job.payload.runId))
    return "done";
  if(deps.deadline-Date.now()<140_000){
    await queue.release(job.id,job.progress);
    return "released";
  }
  const store=createObservedRunStore(sql);
  let admitted:Awaited<ReturnType<typeof store.beginJob>>;
  try{
    admitted=await store.beginJob(job.organizationId,job.repositoryId,
      job.payload.runId,job.id,job.attempts);
  }catch{
    await store.fail(job.organizationId,job.payload.runId,"test_bench_snapshot_invalid");
    return "done";
  }
  if(!admitted)return "done";
  const {row,cases}=admitted;
  try{
    const configured=deps.clients();
    if(!configured)throw new ObservedEvaluationError("test_bench_provider_unconfigured");
    // Read the *admission-time* pinned commit, never today's default branch.
    const instructions=await deps.readInstructions(row.organization_id,row.repository_id,
      row.source_path,row.source_commit_sha);
    if(!instructions)throw new ObservedEvaluationError("test_bench_skill_missing");
    const accepted=[] as import("./observed-evaluator.ts").ObservedCase[];
    const result=await executeObservedCases({
      skillName:row.skill_id,instructions,cases,clients:configured,
      onCase:async(sample,index)=>{
        await store.recordCase(row,sample,index,accepted);
        accepted.push(sample);
      },
    });
    await store.complete(row,result);
  }catch(error){
    // Deliberately never persist or log raw model output, prompts or provider errors.
    await store.fail(row.organization_id,row.id,safeFailure(error));
  }
  return "done";
}
/** Concrete production bridge; client mocks are accepted only by the explicit
 * testable helper above, not in HTTP routes or deployed workers.
 */
export async function runObservedTestBenchJob(
  ctx:{sql:Sql;queue:JobQueue;deadline:number;runtime:GitRuntime},
  job:BackgroundJob,
):Promise<"done"|"released">{
  return executeQueuedObservedRun({
    sql:ctx.sql,queue:ctx.queue,deadline:ctx.deadline,job,
    readInstructions:async(organizationId,repositoryId,sourcePath,commitSha)=>{
      const repository=await openRepositoryFiles(ctx.runtime,organizationId,repositoryId,commitSha);
      if(repository.commitSha!==commitSha)
        throw new ObservedEvaluationError("test_bench_source_mismatch");
      return repository.read(`${sourcePath}/SKILL.md`,MAX_SKILL_INSTRUCTIONS_BYTES);
    },
    clients:()=>{
      const config=readAiServiceConfig();
      if(!config.nim||!config.jev)return null;
      return {
        executor:createNimChatClient(config.nim,config.nim.executionModel),
        judge:createJevClient(config.jev),
      };
    },
  });
}
