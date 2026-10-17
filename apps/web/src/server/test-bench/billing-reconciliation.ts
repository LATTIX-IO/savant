import type {Sql} from "postgres";
import {TestBenchError} from "./definition-contract.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const deny=(code:string,status=409):never=>{throw new TestBenchError(code,status);};

/** Verified provider billing is not available in 7A. In particular,
 * account-wide invoices cannot be attributed to individual tenants or runs.
 */
export type BillingEvidenceState=
  "confirmed"|"estimated"|"unknown"|"disputed"|"externally-billed";
export type RunBillingPhase={
  caseIndex:number;phase:"executor"|"judge";
  provider:"nim"|"jev"|"openai";model:string|null;
  receiptAcknowledged:boolean;reportedTokens:number|null;
  state:Exclude<BillingEvidenceState,"confirmed">;
};
export type RunBillingEvidence={
  runId:string;rateCardId:string|null;
  reservationMicroUsd:number;
  state:Exclude<BillingEvidenceState,"confirmed">;
  phases:RunBillingPhase[];
  historicalUnattributedReceipts:number;
  actualBilledMicroUsd:null;
  providerInvoiceMatched:false;
};
type StoredRun={
 id:string;rate_card_id:string|null;reserved_micro_usd:string|number;
 execution_source:"platform-nim"|"workspace-openai";
 execution_model_pinned:string|null;judge_model_pinned:string|null;
};
type Intent={
 case_index:number;phase:"executor"|"judge";
 provider_code:"nim"|"jev"|"openai";
 acknowledged_at:Date|null;model:string|null;
 prompt_tokens:number|null;completion_tokens:number|null;
};
function phaseEvidence(run:StoredRun,intent:Intent,
  approvedModels:Set<string>):RunBillingPhase{
  const receiptAcknowledged=intent.acknowledged_at!==null&&
    intent.model!==null&&intent.prompt_tokens!==null&&
    intent.completion_tokens!==null;
  const expectedProvider=intent.phase==="judge"?"jev":
    run.execution_source==="platform-nim"?"nim":"openai";
  const expectedModel=intent.phase==="judge"?
    run.judge_model_pinned:run.execution_model_pinned;
  const providerValid=intent.provider_code===expectedProvider;
  const modelValid=!expectedModel||expectedModel===intent.model;
  const rateValid=run.rate_card_id!==null&&
    intent.provider_code!=="openai"&&intent.model!==null&&
    approvedModels.has(intent.provider_code+":"+intent.model);
  // Provider reconciliation is impossible without request-level attestation.
  // Even perfect usage ACK and a price match is only an ESTIMATE.
  const state:RunBillingPhase["state"]=!providerValid||
      (receiptAcknowledged&&!modelValid)||
      (receiptAcknowledged&&run.rate_card_id!==null&&
        intent.provider_code!=="openai"&&!rateValid)
    ?"disputed":
    !receiptAcknowledged?"unknown":
    intent.provider_code==="openai"?"externally-billed":
    rateValid?"estimated":"unknown";
  return {
    caseIndex:intent.case_index,phase:intent.phase,provider:intent.provider_code,
    model:intent.model,receiptAcknowledged,
    reportedTokens:receiptAcknowledged?
      intent.prompt_tokens!+intent.completion_tokens!:null,state,
  };
}
export function reconcileRunEvidence(input:{
  run:StoredRun;intents:Intent[];rateModels:Set<string>;
  historicalUnattributedReceipts:number;
}):RunBillingEvidence{
  const phases=input.intents.map(i=>phaseEvidence(input.run,i,input.rateModels));
  let state:RunBillingEvidence["state"];
  if(phases.some(x=>x.state==="disputed"))state="disputed";
  else if(input.historicalUnattributedReceipts>0||
    phases.length===0||phases.some(x=>x.state==="unknown"))state="unknown";
  else if(phases.some(x=>x.state==="estimated"))state="estimated";
  else state="externally-billed";
  return {
    runId:input.run.id,rateCardId:input.run.rate_card_id,
    reservationMicroUsd:Number(input.run.reserved_micro_usd),
    state,phases,historicalUnattributedReceipts:
      input.historicalUnattributedReceipts,
    actualBilledMicroUsd:null,providerInvoiceMatched:false,
  };
}
export function createRunBillingEvidenceReader(sql:Sql){
  return {
    async read(organizationId:string,runId:string):Promise<RunBillingEvidence>{
      if(!UUID.test(organizationId)||!UUID.test(runId))
        return deny("test_bench_billing_run_invalid",422);
      return sql.begin(async tx=>{
        const [run]=await tx<StoredRun[]>`
          select id,rate_card_id,reserved_micro_usd,execution_source,
            execution_model_pinned,judge_model_pinned
          from test_bench_runs where organization_id=${organizationId}
            and id=${runId}
        `;
        if(!run)return deny("test_bench_billing_run_not_found",404);
        const intents=await tx<Intent[]>`
          select i.case_index,i.phase,i.provider_code,i.acknowledged_at,
            u.model,u.prompt_tokens,u.completion_tokens
          from test_bench_provider_call_intents i
          left join test_bench_provider_usage_receipts u
            on u.organization_id=i.organization_id and u.run_id=i.run_id
              and u.case_index=i.case_index and u.phase=i.phase
          where i.organization_id=${organizationId} and i.run_id=${runId}
          order by i.case_index,i.phase
        `;
        const [missing]=await tx<{n:number}[]>`
          select count(*)::int as n from test_bench_provider_usage_receipts u
          where u.organization_id=${organizationId} and u.run_id=${runId}
            and not exists(select 1 from test_bench_provider_call_intents i
              where i.organization_id=u.organization_id
                and i.run_id=u.run_id and i.case_index=u.case_index
                and i.phase=u.phase)
        `;
        const rateRows=run.rate_card_id?
          await tx<{provider_code:string;model:string}[]>`
            select provider_code,model from test_bench_provider_rate_entries
            where rate_card_id=${run.rate_card_id}
          `: [];
        return reconcileRunEvidence({
          run,intents,rateModels:new Set(rateRows.map(r=>r.provider_code+":"+r.model)),
          historicalUnattributedReceipts:missing?.n??0,
        });
      });
    },
  };
}
