import type {Sql} from "postgres";
import {TestBenchError} from "./definition-contract.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const invalid=(code:string,status=409):never=>{throw new TestBenchError(code,status);};

export type ObservedProviderUsage={
  index:number;phase:"executor"|"judge";model:string;
  promptTokens:number;completionTokens:number;
};
type ReceiptRow={
  model:string;prompt_tokens:number;completion_tokens:number;
};
export function validateObservedProviderUsage(value:ObservedProviderUsage):void{
  if(!value||typeof value!=="object"||
    !Number.isSafeInteger(value.index)||value.index<1||value.index>4||
    !["executor","judge"].includes(value.phase)||
    typeof value.model!=="string"||!value.model.trim()||
    value.model.length>160||
    !Number.isSafeInteger(value.promptTokens)||
    !Number.isSafeInteger(value.completionTokens)||
    value.promptTokens<0||value.completionTokens<0||
    value.promptTokens>1_000_000||value.completionTokens>1_000_000||
    value.promptTokens+value.completionTokens<=0)
    invalid("test_bench_usage_receipt_invalid",422);
}

/** Immutable usage ACK. The provider may charge for lost or timed-out calls
 * without returning usage; absence of a receipt NEVER means zero invoiced cost.
 * A cancellation during a remote request must not discard the returned ACK.
 */
export function createObservedProviderUsageStore(sql:Sql){
  return {
    async record(
      organizationId:string,runId:string,jobId:string,receipt:ObservedProviderUsage,
    ):Promise<{recorded:boolean}>{
      if(!UUID.test(organizationId)||!UUID.test(runId)||!UUID.test(jobId))
        invalid("test_bench_usage_receipt_invalid",422);
      validateObservedProviderUsage(receipt);
      return sql.begin(async tx=>{
        const [run]=await tx<{
          status:string;expected_cases:number;
        }[]>`
          select status,expected_cases from test_bench_runs
          where organization_id=${organizationId} and id=${runId}
            and job_id=${jobId} for update
        `;
        if(!run)return invalid("test_bench_usage_run_unavailable",404);
        if(receipt.index>run.expected_cases)
          return invalid("test_bench_usage_receipt_invalid",422);
        const [previous]=await tx<ReceiptRow[]>`
          select model,prompt_tokens,completion_tokens
          from test_bench_provider_usage_receipts
          where organization_id=${organizationId} and run_id=${runId}
            and case_index=${receipt.index} and phase=${receipt.phase}
        `;
        if(previous){
          if(previous.model!==receipt.model||
            previous.prompt_tokens!==receipt.promptTokens||
            previous.completion_tokens!==receipt.completionTokens)
            return invalid("test_bench_usage_receipt_conflict");
          return {recorded:false};
        }
        if(run.status!=="running"&&run.status!=="canceled")
          return invalid("test_bench_usage_run_not_active");
        await tx`
          insert into test_bench_provider_usage_receipts(
            organization_id,run_id,case_index,phase,model,
            prompt_tokens,completion_tokens
          ) values (
            ${organizationId},${runId},${receipt.index},${receipt.phase},
            ${receipt.model},${receipt.promptTokens},${receipt.completionTokens}
          )
        `;
        const count=receipt.promptTokens+receipt.completionTokens;
        await tx`
          update test_bench_runs set
            observed_executor_tokens=observed_executor_tokens+
              ${receipt.phase==="executor"?count:0},
            observed_judge_tokens=observed_judge_tokens+
              ${receipt.phase==="judge"?count:0},
            observed_usage_receipts=observed_usage_receipts+1,
            updated_at=now()
          where organization_id=${organizationId} and id=${runId}
            and job_id=${jobId}
        `;
        return {recorded:true};
      });
    },
  };
}
