import type {Sql} from "postgres";
import {TestBenchError} from "./definition-contract.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=(code:string,status=409):never=>{throw new TestBenchError(code,status);};
export type ObservedProviderPhase="executor"|"judge";
export type ObservedProviderIntent={
  index:number;phase:ObservedProviderPhase;
};
export type ObservedIntentProvider="nim"|"openai"|"jev";

/** No caller-provided origin, model, credential or billing fields. */
export function providerForIntent(
  phase:ObservedProviderPhase,source:"platform-nim"|"workspace-openai",
):ObservedIntentProvider{
  if(phase==="judge")return "jev";
  if(phase==="executor"&&source==="platform-nim")return "nim";
  if(phase==="executor"&&source==="workspace-openai")return "openai";
  return invalid("test_bench_provider_intent_invalid",422);
}
export function validateObservedProviderIntent(value:ObservedProviderIntent):void{
  if(!value||!Number.isSafeInteger(value.index)||value.index<1||value.index>4||
    (value.phase!=="executor"&&value.phase!=="judge"))
    invalid("test_bench_provider_intent_invalid",422);
}

/** A row is durable evidence the worker *intended* to make an external call,
 * not evidence that the provider received it, returned or billed anything.
 * A previously recorded intent prevents another paid dispatch on the same key.
 */
export function createObservedProviderCallIntentStore(sql:Sql){
  return {
    async record(organizationId:string,runId:string,jobId:string,
      intent:ObservedProviderIntent):Promise<void>{
      if(!UUID.test(organizationId)||!UUID.test(runId)||!UUID.test(jobId))
        invalid("test_bench_provider_intent_invalid",422);
      validateObservedProviderIntent(intent);
      await sql.begin(async tx=>{
        const [run]=await tx<{
          status:string;expected_cases:number;completed_cases:number;
          execution_source:"platform-nim"|"workspace-openai";
        }[]>`
          select status,expected_cases,completed_cases,execution_source
          from test_bench_runs
          where organization_id=${organizationId} and id=${runId}
            and job_id=${jobId} for update
        `;
        if(!run)return invalid("test_bench_provider_intent_run_unavailable",404);
        if(run.status!=="running")return invalid("test_bench_provider_intent_run_not_active");
        if(intent.index!==run.completed_cases+1||intent.index>run.expected_cases)
          return invalid("test_bench_provider_intent_out_of_order");
        const provider=providerForIntent(intent.phase,run.execution_source);
        if(intent.phase==="judge"){
          const [executor]=await tx<{phase:string}[]>`
            select phase from test_bench_provider_usage_receipts
            where organization_id=${organizationId} and run_id=${runId}
              and case_index=${intent.index} and phase='executor'
          `;
          if(!executor)return invalid("test_bench_provider_intent_executor_unacknowledged");
        }
        const [recorded]=await tx<{case_index:number}[]>`
          insert into test_bench_provider_call_intents(
            organization_id,run_id,job_id,case_index,phase,provider_code
          ) values (
            ${organizationId},${runId},${jobId},
            ${intent.index},${intent.phase},${provider}
          ) on conflict(organization_id,run_id,case_index,phase) do nothing
          returning case_index
        `;
        if(!recorded)return invalid("test_bench_provider_intent_replayed");
      });
    },
  };
}
