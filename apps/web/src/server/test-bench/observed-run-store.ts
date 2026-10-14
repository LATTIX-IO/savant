import {randomUUID} from "node:crypto";
import type {GitActor} from "../git/access-control.ts";
import {assertGitPermission} from "../git/access-control.ts";
import {requirePinnedEvaluationCommit} from "../jobs/eval-source-revision.ts";
import {parseTestBenchCases,TestBenchError,type TestBenchCase} from "./definition-contract.ts";
import {decryptTestBenchCases,encryptTestBenchCases} from "./definition-crypto.ts";
import {MAX_OBSERVED_CASES,OBSERVED_SCORING_FINGERPRINT,ObservedEvaluationError,type ObservedCase,type ObservedEvaluation} from "./observed-evaluator.ts";
import {assertValidTenantOpenAiConnection,type PinnedWorkspaceRun} from "./tenant-openai-client.ts";
import {readDailyAdmissionQuota,reserveDailyAdmission} from "./observed-admission-quota.ts";
import {reservePlatformProviderAdmission} from "./platform-provider-admission.ts";

type Sql=import("postgres").Sql;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RunRow=PinnedWorkspaceRun&{
  id:string;organization_id:string;repository_id:string;definition_id:string;
  definition_revision:number;skill_id:string;source_path:string;source_commit_sha:string;
  request_id:string;requested_by:string;snapshot_ciphertext:string;
  results_ciphertext:string|null;status:"queued"|"running"|"complete"|"failed"|"canceled";
  expected_cases:number;completed_cases:number;total_tokens:number;estimated_cost_usd:string|number;
  observed_executor_tokens:number;observed_judge_tokens:number;observed_usage_receipts:number;
  scorecard:Record<string,unknown>|null;execution_model:string|null;judge_model:string|null;
  job_id:string|null;error_code:string|null;canceled_by:string|null;canceled_at:Date|string|null;
  cost_accounting:"platform-estimate"|"normalized-qa-proxy";
  created_at:Date|string;updated_at:Date|string;completed_at:Date|string|null;
};
export type ObservedRunSummary={
  id:string;skillId:string;definitionId:string;definitionRevision:number;
  sourceCommitSha:string;status:RunRow["status"];expectedCases:number;completedCases:number;
  samples:ObservedCase[];scorecard:Record<string,unknown>|null;
  totalTokens:number;estimatedCostUsd:number;executionModel:string|null;judgeModel:string|null;
  observedExecutorTokens:number;observedJudgeTokens:number;observedUsageReceipts:number;
  errorCode:string|null;canceledBy:string|null;canceledAt:string|null;
  executionSource:RunRow["execution_source"];executionModelPinned:string|null;
  costAccounting:RunRow["cost_accounting"];
  createdAt:string;updatedAt:string;completedAt:string|null;
};
const invalid=(code:string,status=409):never=>{throw new TestBenchError(code,status);};
function actorAllowed(actor:GitActor,write:boolean):void{
  if(!actor.organizationId||!actor.subject)invalid("auth_required",401);
  assertGitPermission(actor,write?"connect_repository":"view");
}
function validateId(value:string):void{
  if(!UUID.test(value))invalid("test_bench_not_found",404);
}
function iso(date:Date|string|null):string|null{
  if(!date)return null;
  return date instanceof Date?date.toISOString():new Date(date).toISOString();
}
function ctx(row:RunRow){
  return {organizationId:row.organization_id,definitionId:row.id,
    revision:row.definition_revision,commitSha:row.source_commit_sha};
}
function samples(row:RunRow):ObservedCase[]{
  if(!row.results_ciphertext)return [];
  try{
    const data=JSON.parse(decryptTestBenchCases(row.results_ciphertext,ctx(row),process.env,65536)) as unknown;
    if(!Array.isArray(data)||data.length>MAX_OBSERVED_CASES)
      invalid("test_bench_evidence_invalid",503);
    return data as ObservedCase[];
  }catch(error){
    if(error instanceof TestBenchError&&error.code==="test_bench_key_unconfigured")throw error;
    return invalid("test_bench_evidence_invalid",503);
  }
}
function publicRun(row:RunRow):ObservedRunSummary{
  return {
    id:row.id,skillId:row.skill_id,definitionId:row.definition_id,
    definitionRevision:row.definition_revision,sourceCommitSha:row.source_commit_sha,
    status:row.status,expectedCases:row.expected_cases,completedCases:row.completed_cases,
    samples:samples(row),scorecard:row.scorecard,totalTokens:row.total_tokens,
    estimatedCostUsd:Number(row.estimated_cost_usd),
    observedExecutorTokens:row.observed_executor_tokens,
    observedJudgeTokens:row.observed_judge_tokens,
    observedUsageReceipts:row.observed_usage_receipts,
    executionModel:row.execution_model,judgeModel:row.judge_model,
    executionSource:row.execution_source,executionModelPinned:row.execution_model_pinned,
    costAccounting:row.cost_accounting,
    errorCode:row.error_code,canceledBy:row.canceled_by,canceledAt:iso(row.canceled_at),
    createdAt:iso(row.created_at)??"",updatedAt:iso(row.updated_at)??"",
    completedAt:iso(row.completed_at),
  };
}
function validRequest(requestId:string,expectedRevision:number):void{
  if(!UUID.test(requestId))invalid("test_bench_run_request_invalid",422);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
    invalid("test_bench_revision_required",428);
}
export function createObservedRunStore(sql:Sql){
  return {
    async start(actor:GitActor,skillId:string,definitionId:string,
      input:{requestId:string;expectedRevision:number;executionSource?:"platform-nim"|"workspace-openai"}):
      Promise<{run:ObservedRunSummary;replayed:boolean}>{
      actorAllowed(actor,true);validateId(definitionId);validRequest(input.requestId,input.expectedRevision);
      if(!skillId||skillId.length>300)invalid("test_bench_skill_invalid",422);
      const executionSource=input.executionSource??"platform-nim";
      if(executionSource!=="platform-nim"&&executionSource!=="workspace-openai")
        return invalid("test_bench_execution_source_invalid",422);
      try{
        return await sql.begin(async tx=>{
          // Serialize tenant capacity and all idempotency checks across definitions.
          await tx`select pg_advisory_xact_lock(hashtext(${actor.organizationId}),1)`;
          const [previous]=await tx<RunRow[]>`
            select * from test_bench_runs
            where organization_id=${actor.organizationId} and request_id=${input.requestId}
            for update
          `;
          if(previous){
            if(previous.definition_id!==definitionId||previous.skill_id!==skillId||
              previous.definition_revision!==input.expectedRevision||
              previous.requested_by!==actor.subject||
              previous.execution_source!==executionSource)
              invalid("test_bench_run_request_conflict");
            return {run:publicRun(previous),replayed:true};
          }
          const [existing]=await tx<{n:number}[]>`
            select count(*)::int as n from test_bench_runs
            where organization_id=${actor.organizationId} and status in ('queued','running')
          `;
          if((existing?.n??0)>=2)invalid("test_bench_tenant_capacity_exceeded",429);
          const [def]=await tx<{
            id:string;organization_id:string;repository_id:string;skill_id:string;
            source_path:string;source_commit_sha:string;revision:number;
            cases_ciphertext:string;
          }[]>`
            select d.id,d.organization_id,d.repository_id,d.skill_id,d.source_path,
              d.source_commit_sha,d.revision,d.cases_ciphertext
            from test_bench_definitions d
              join repositories r on r.organization_id=d.organization_id and r.id=d.repository_id
            where d.organization_id=${actor.organizationId} and d.skill_id=${skillId}
              and d.id=${definitionId} and d.archived_at is null
              and r.status<>'disabled'
            for share of d
          `;
          if(!def)return invalid("test_bench_not_found",404);
          if(def.revision!==input.expectedRevision)invalid("test_bench_revision_conflict");
          let commitSha:string;
          try{commitSha=requirePinnedEvaluationCommit(def.source_commit_sha);}
          catch{return invalid("test_bench_source_not_pinned");}
          const cases=parseTestBenchCases(JSON.parse(decryptTestBenchCases(def.cases_ciphertext,{
            organizationId:actor.organizationId,definitionId,revision:def.revision,
            commitSha,
          })) as unknown);
          if(cases.length>MAX_OBSERVED_CASES)
            invalid("test_bench_execution_case_limit",422);
          const [candidate]=executionSource==="workspace-openai"?
            await tx<{
              id:string;organization_id:string;provider_type:string;default_model:string;
              supports_execution:boolean;is_default_execution:boolean;status:string;
              allowed_models:unknown;secret_fingerprint:string|null;
            }[]>`
              select c.id,c.organization_id,c.provider_type,c.default_model,
                c.supports_execution,c.is_default_execution,c.status,c.allowed_models,
                s.secret_fingerprint
              from ai_connections c
                join ai_connection_secrets s on s.ai_connection_id=c.id
              where c.organization_id=${actor.organizationId} and c.is_default_execution=true
                and c.status='active' and c.provider_type='openai'
              limit 1
            `: [];
          let selected:ReturnType<typeof assertValidTenantOpenAiConnection>|null=null;
          if(executionSource==="workspace-openai"){
            try{selected=assertValidTenantOpenAiConnection(candidate,actor.organizationId);}
            catch(error){
              if(error instanceof ObservedEvaluationError)
                return invalid("test_bench_workspace_openai_unavailable",503);
              throw error;
            }
          }
          const id=randomUUID();
          const snapshot=encryptTestBenchCases(JSON.stringify(cases),{
            organizationId:actor.organizationId,definitionId:id,
            revision:def.revision,commitSha,
          });
          // Count every accepted run, regardless of provider mode. Reserve only
          // after idempotency and source/credential validation. Transactional
          // rollback makes failed jobs or failed inserts unable to leak units.
          await reservePlatformProviderAdmission(tx,executionSource);
          await reserveDailyAdmission(tx,actor.organizationId);
          const [row]=await tx<RunRow[]>`
            insert into test_bench_runs(
              id,organization_id,repository_id,definition_id,definition_revision,
              skill_id,source_path,source_commit_sha,request_id,requested_by,
              snapshot_ciphertext,expected_cases,execution_source,
              execution_connection_id,execution_secret_fingerprint,
              execution_model_pinned,cost_accounting
            ) values(
              ${id},${actor.organizationId},${def.repository_id},${definitionId},
              ${def.revision},${skillId},${def.source_path},${commitSha},
              ${input.requestId},${actor.subject},${snapshot},${cases.length},
              ${executionSource},${selected?.connectionId??null},
              ${selected?.fingerprint??null},${selected?.model??null},
              ${selected?"normalized-qa-proxy":"platform-estimate"}
            ) returning *
          `;
          if(!row)return invalid("test_bench_run_unavailable",503);
          const [job]=await tx<{id:string}[]>`
            insert into background_jobs(
              organization_id,repository_id,kind,dedupe_key,payload
            ) values(
              ${actor.organizationId},${def.repository_id},'test_bench_run',
              ${id},${tx.json({runId:id})}::jsonb
            ) returning id
          `;
          if(!job)return invalid("test_bench_run_unavailable",503);
          await tx`
            update test_bench_runs set job_id=${job.id}
            where organization_id=${actor.organizationId} and id=${id}
          `;
          await tx`
            insert into audit_events(
              organization_id,actor_type,actor_ref,category,action,
              target_type,target_ref,request_id,payload_redacted
            ) values(
              ${actor.organizationId},'user',${actor.subject},'evaluation',
              'test_bench_run_queued','test_bench_run',${id},${input.requestId},
              ${tx.json({cases:cases.length,revision:def.revision,commitPrefix:commitSha.slice(0,12),executionSource})}::jsonb
            )
          `;
          return {run:publicRun({...row,job_id:job.id}),replayed:false};
        });
      }catch(error){
        if(error instanceof TestBenchError)throw error;
        if((error as {code?:string})?.code==="23505")
          invalid("test_bench_run_already_active");
        throw error;
      }
    },
    /** Read-only active-workspace UTC admission quota, no credential metadata. */
    async quota(actor:GitActor){
      actorAllowed(actor,false);
      return readDailyAdmissionQuota(sql,actor.organizationId);
    },
    async list(actor:GitActor,skillId:string,definitionId:string):Promise<ObservedRunSummary[]>{
      actorAllowed(actor,false);validateId(definitionId);
      const rows=await sql<RunRow[]>`
        select * from test_bench_runs
        where organization_id=${actor.organizationId} and skill_id=${skillId}
          and definition_id=${definitionId}
        order by created_at desc limit 15
      `;
      return rows.map(publicRun);
    },
    async get(actor:GitActor,skillId:string,definitionId:string,id:string):Promise<ObservedRunSummary>{
      actorAllowed(actor,false);validateId(definitionId);validateId(id);
      const [row]=await sql<RunRow[]>`
        select * from test_bench_runs where organization_id=${actor.organizationId}
          and skill_id=${skillId} and definition_id=${definitionId} and id=${id}
      `;
      if(!row)return invalid("test_bench_run_not_found",404);
      return publicRun(row);
    },
    /** Terminal, idempotent cancellation. Queued jobs are de-queued in the same
     * transaction; running jobs cooperatively stop before their next provider call.
     */
    async cancel(actor:GitActor,skillId:string,definitionId:string,runId:string,
      expectedRevision:number):Promise<{run:ObservedRunSummary;replayed:boolean}>{
      actorAllowed(actor,true);validateId(definitionId);validateId(runId);
      if(!Number.isSafeInteger(expectedRevision)||expectedRevision<1)
        return invalid("test_bench_revision_required",428);
      return sql.begin(async tx=>{
        const [current]=await tx<RunRow[]>`
          select * from test_bench_runs
          where organization_id=${actor.organizationId}
            and skill_id=${skillId} and definition_id=${definitionId} and id=${runId}
          for update
        `;
        if(!current)return invalid("test_bench_run_not_found",404);
        if(current.definition_revision!==expectedRevision)
          return invalid("test_bench_revision_conflict");
        if(current.status==="canceled")
          return {run:publicRun(current),replayed:true};
        if(current.status!=="queued"&&current.status!=="running")
          return invalid("test_bench_run_already_terminal");
        const [updated]=await tx<RunRow[]>`
          update test_bench_runs set status='canceled',canceled_at=now(),
            canceled_by=${actor.subject},completed_at=now(),updated_at=now(),scorecard=null
          where organization_id=${actor.organizationId} and id=${runId}
            and status in ('queued','running')
          returning *
        `;
        if(!updated)return invalid("test_bench_run_already_terminal");
        if(current.status==="queued"&&current.job_id){
          await tx`
            update background_jobs set status='failed',lease_until=null,
              error='Canceled before execution.',completed_at=now(),updated_at=now()
            where id=${current.job_id} and organization_id=${actor.organizationId}
              and kind='test_bench_run' and status='queued'
          `;
        }
        await tx`
          insert into audit_events(
            organization_id,actor_type,actor_ref,category,action,target_type,
            target_ref,payload_redacted
          ) values (
            ${actor.organizationId},'user',${actor.subject},'evaluation',
            'test_bench_run_canceled','test_bench_run',${runId},
            ${tx.json({from:current.status,revision:current.definition_revision,
              completedCases:current.completed_cases})}::jsonb
          )
        `;
        return {run:publicRun(updated),replayed:false};
      });
    },
    /** Every network boundary checks the committed terminal state. An already
     * in-flight third-party request cannot be forcibly interrupted here.
     */
    async isRunning(organizationId:string,runId:string,jobId:string):Promise<boolean>{
      const [state]=await sql<{status:RunRow["status"]}[]>`
        select status from test_bench_runs
        where organization_id=${organizationId} and id=${runId} and job_id=${jobId}
      `;
      return state?.status==="running";
    },
    /** A reclaimed after-provider-I/O lease is never allowed to re-execute provider calls. */
    async beginJob(organizationId:string,repositoryId:string,runId:string,jobId:string,attempts:number):
      Promise<{row:RunRow;cases:TestBenchCase[]}|null>{
      const [row]=await sql<RunRow[]>`
        select * from test_bench_runs
        where organization_id=${organizationId} and repository_id=${repositoryId}
          and id=${runId} and job_id=${jobId}
      `;
      if(!row||row.status==="complete"||row.status==="failed"||row.status==="canceled")return null;
      if(attempts!==1||row.status!=="queued"){
        await this.fail(organizationId,runId,"test_bench_unconfirmed_provider_retry");
        return null;
      }
      // Authenticated decryption and snapshot verification happen *before* any model I/O.
      let frozen:TestBenchCase[];
      try{
        frozen=parseTestBenchCases(JSON.parse(
          decryptTestBenchCases(row.snapshot_ciphertext,ctx(row))) as unknown);
      }catch(error){
        if(error instanceof TestBenchError&&error.code==="test_bench_key_unconfigured")throw error;
        await this.fail(organizationId,runId,"test_bench_snapshot_invalid");
        return null;
      }
      if(frozen.length!==row.expected_cases||frozen.length>MAX_OBSERVED_CASES){
        await this.fail(organizationId,runId,"test_bench_snapshot_invalid");
        return null;
      }
      const [started]=await sql<RunRow[]>`
        update test_bench_runs set status='running',updated_at=now()
        where organization_id=${organizationId} and repository_id=${repositoryId}
          and id=${runId} and job_id=${jobId} and status='queued'
        returning *
      `;
      if(!started)return null;
      return {row:started,cases:frozen};
    },
    async recordCase(row:RunRow,caseData:ObservedCase,index:number,
      previous:readonly ObservedCase[]):Promise<void>{
      if(index!==previous.length+1||index>row.expected_cases)
        invalid("test_bench_progress_out_of_order");
      const ciphertext=encryptTestBenchCases(JSON.stringify([...previous,caseData]),ctx(row),process.env,65536);
      const [saved]=await sql<{id:string}[]>`
        update test_bench_runs set results_ciphertext=${ciphertext},
          completed_cases=${index},updated_at=now()
        where organization_id=${row.organization_id} and id=${row.id}
          and status='running' and completed_cases=${index-1}
        returning id
      `;
      if(!saved)invalid("test_bench_progress_conflict");
    },
    async complete(row:RunRow,result:ObservedEvaluation):Promise<void>{
      if(result.samples.length!==row.expected_cases||row.expected_cases>MAX_OBSERVED_CASES)
        invalid("test_bench_incomplete");
      const ciphertext=encryptTestBenchCases(JSON.stringify(result.samples),ctx(row),process.env,65536);
      await sql.begin(async tx=>{
        const [saved]=await tx<{id:string}[]>`
          update test_bench_runs set status='complete',completed_at=now(),updated_at=now(),
            results_ciphertext=${ciphertext},completed_cases=${row.expected_cases},
            scorecard=${tx.json({...result.scorecard,scoringContract:OBSERVED_SCORING_FINGERPRINT})}::jsonb,
            total_tokens=${result.totalTokens},estimated_cost_usd=${result.estimatedCostUsd},
            execution_model=${result.executionModel},judge_model=${result.judgeModel},
            error_code=null
          where organization_id=${row.organization_id} and id=${row.id}
            and status='running' and completed_cases=${row.expected_cases}
          returning id
        `;
        if(!saved)invalid("test_bench_progress_conflict");
        // A complete quality score requires BOTH independently acknowledged
        // provider phases for EVERY observed case. The check and transition
        // are one transaction: absence/tampering rolls back the score.
        const [usage]=await tx<{
          receipts:number;tokens:number;
        }[]>`
          select count(*)::int as receipts,
            coalesce(sum(prompt_tokens+completion_tokens),0)::int as tokens
          from test_bench_provider_usage_receipts
          where organization_id=${row.organization_id} and run_id=${row.id}
        `;
        if(!usage||usage.receipts!==row.expected_cases*2||
          usage.tokens!==result.totalTokens)
          invalid("test_bench_usage_evidence_incomplete");
        await tx`
          insert into audit_events(
            organization_id,actor_type,actor_ref,category,action,target_type,target_ref,payload_redacted
          ) values(
            ${row.organization_id},'system','test-bench-worker','evaluation',
            'test_bench_run_completed','test_bench_run',${row.id},
            ${tx.json({cases:row.expected_cases,sourceRevision:row.definition_revision,
              execution:"chat_only",tokens:result.totalTokens})}::jsonb
          )
        `;
      });
    },
    async fail(organizationId:string,runId:string,errorCode:string):Promise<void>{
      const safe=/^test_bench_[a-z0-9_]{1,70}$/.test(errorCode)?
        errorCode:"test_bench_provider_execution_failed";
      await sql.begin(async tx=>{
        const [row]=await tx<{id:string}[]>`
          update test_bench_runs set status='failed',updated_at=now(),completed_at=now(),
            error_code=${safe},scorecard=null
          where organization_id=${organizationId} and id=${runId}
            and status in ('queued','running')
          returning id
        `;
        if(!row)return;
        await tx`
          insert into audit_events(
            organization_id,actor_type,actor_ref,category,action,target_type,target_ref,payload_redacted
          ) values(
            ${organizationId},'system','test-bench-worker','evaluation',
            'test_bench_run_failed','test_bench_run',${runId},
            ${tx.json({code:safe})}::jsonb
          )
        `;
      });
    },
  };
}
