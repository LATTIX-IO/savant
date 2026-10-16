import type {Sql,TransactionSql} from "postgres";
import {readAiServiceConfig} from "../ai/clients.ts";
import {TestBenchError} from "./definition-contract.ts";

const MAX_MICRO_USD=1_000_000_000_000n;
const MICROS_PER_MILLION_TOKENS=1_000_000n;
/** Over-reservation planning assumptions, not guaranteed provider token maxima.
 * Providers may apply different usage/billing semantics. Zero claims of cap.
 */
export const PLANNED_INPUT_TOKENS_PER_CALL=32_768;
export const PLANNED_OUTPUT_TOKENS_PER_CALL=8_192;
export const PLANNED_MAX_CASES=4;
const deny=(code:string,status=503):never=>{throw new TestBenchError(code,status);};
export type MonetaryProvider="nim"|"jev";
export type MonetaryRate={
  provider_code:MonetaryProvider;model:string;
  input_micro_usd_per_million:string|number|bigint;
  output_micro_usd_per_million:string|number|bigint;
  fixed_micro_usd_per_call:string|number|bigint;
};
export type MonetaryReservation={
  rateCardId:string;reservedMicroUsd:number;
  executionModel:string|null;judgeModel:string;
};
type Env=Record<string,string|undefined>;
/** Production is always gated, even when a feature flag is explicitly off.
 * Local/integration can opt in. No live rates are populated by migrations.
 */
export function monetaryAdmissionRequired(env:Env=process.env):boolean{
  return env.VERCEL_ENV==="production"||
    env.SAVANT_TEST_BENCH_MONETARY_ENFORCE==="1";
}
function amount(value:unknown):bigint{
  if((typeof value!=="string"||!/^(0|[1-9]\d{0,12})$/.test(value))&&
    (typeof value!=="number"||!Number.isSafeInteger(value)||value<0)&&
    (typeof value!=="bigint"||value<0n))
    return deny("test_bench_rate_invalid");
  const parsed=BigInt(value as string|number|bigint);
  if(parsed>MAX_MICRO_USD)return deny("test_bench_rate_invalid");
  return parsed;
}
export function plannedMicroUsd(rate:MonetaryRate,cases:number):number{
  if(!Number.isSafeInteger(cases)||cases<1||cases>PLANNED_MAX_CASES||
    !["nim","jev"].includes(rate.provider_code)||
    typeof rate.model!=="string"||!rate.model.trim()||rate.model.length>160)
    return deny("test_bench_rate_invalid");
  const input=amount(rate.input_micro_usd_per_million);
  const output=amount(rate.output_micro_usd_per_million);
  const fixed=amount(rate.fixed_micro_usd_per_call);
  if(input+output+fixed===0n)return deny("test_bench_rate_invalid");
  const tokens=BigInt(PLANNED_INPUT_TOKENS_PER_CALL)*input+
    BigInt(PLANNED_OUTPUT_TOKENS_PER_CALL)*output;
  const perCall=(tokens+MICROS_PER_MILLION_TOKENS-1n)/
    MICROS_PER_MILLION_TOKENS+fixed;
  const total=perCall*BigInt(cases);
  if(total<1n||total>MAX_MICRO_USD)return deny("test_bench_rate_invalid");
  return Number(total);
}
export function expectedMonetaryModels(
  source:"platform-nim"|"workspace-openai",env:Env=process.env,
):{provider_code:MonetaryProvider;model:string}[]{
  const config=readAiServiceConfig(env);
  if(!config.jev||!config.jev.model||config.jev.model.length>160)
    return deny("test_bench_rate_provider_unavailable");
  if(source==="workspace-openai")
    return [{provider_code:"jev",model:config.jev.model}];
  if(source!=="platform-nim"||!config.nim||
    !config.nim.executionModel||config.nim.executionModel.length>160)
    return deny("test_bench_rate_provider_unavailable");
  return [{provider_code:"jev",model:config.jev.model},
    {provider_code:"nim",model:config.nim.executionModel}];
}
/** Executed inside the SAME run-admission transaction, after request-id replay.
 * Policy and exact immutable rate models must exist. No per-call refund.
 */
export async function reserveTestBenchMonetaryAdmission(
  tx:TransactionSql,organizationId:string,
  source:"platform-nim"|"workspace-openai",cases:number,
  env:Env=process.env,
):Promise<MonetaryReservation|null>{
  if(!monetaryAdmissionRequired(env))return null;
  if(!Number.isSafeInteger(cases)||cases<1||cases>4)
    return deny("test_bench_rate_invalid");
  const models=expectedMonetaryModels(source,env);
  const [card]=await tx<{id:string}[]>`
    select id from test_bench_provider_rate_cards
    where status='approved' and active and valid_from<=now()
      and (valid_until is null or valid_until>now())
    for share
  `;
  if(!card)return deny("test_bench_rate_unavailable");
  const entries=await tx<MonetaryRate[]>`
    select provider_code,model,input_micro_usd_per_million,
      output_micro_usd_per_million,fixed_micro_usd_per_call
    from test_bench_provider_rate_entries where rate_card_id=${card.id}
  `;
  let cost=0;
  for(const requested of models){
    const entry=entries.find(x=>x.provider_code===requested.provider_code&&
      x.model===requested.model);
    if(!entry)return deny("test_bench_rate_model_unavailable");
    cost+=plannedMicroUsd(entry,cases);
  }
  if(!Number.isSafeInteger(cost)||cost<1||BigInt(cost)>MAX_MICRO_USD)
    return deny("test_bench_rate_invalid");
  const [policy]=await tx<{
    enabled:boolean;daily_limit_micro_usd:string;
    monthly_limit_micro_usd:string;
  }[]>`
    select enabled,daily_limit_micro_usd,monthly_limit_micro_usd
    from test_bench_tenant_monetary_policies
    where organization_id=${organizationId} for share
  `;
  if(!policy?.enabled)return deny("test_bench_monetary_entitlement_unavailable",403);
  const dayCap=amount(policy.daily_limit_micro_usd);
  const monthCap=amount(policy.monthly_limit_micro_usd);
  if(dayCap===0n||monthCap<dayCap||BigInt(cost)>dayCap)
    return deny("test_bench_monetary_capacity_exceeded",429);
  const [day]=await tx<{organization_id:string}[]>`
    insert into test_bench_tenant_monetary_days as ledger(
      organization_id,utc_day,reserved_micro_usd
    ) values (
      ${organizationId},(now() at time zone 'UTC')::date,${cost}
    ) on conflict(organization_id,utc_day) do update set
      reserved_micro_usd=ledger.reserved_micro_usd+${cost},
      updated_at=now()
    where ledger.reserved_micro_usd<=${String(dayCap-BigInt(cost))}
    returning organization_id
  `;
  if(!day)return deny("test_bench_monetary_capacity_exceeded",429);
  const [month]=await tx<{organization_id:string}[]>`
    insert into test_bench_tenant_monetary_months as ledger(
      organization_id,utc_month,reserved_micro_usd
    ) values (
      ${organizationId},date_trunc('month',now() at time zone 'UTC')::date,
      ${cost}
    ) on conflict(organization_id,utc_month) do update set
      reserved_micro_usd=ledger.reserved_micro_usd+${cost},
      updated_at=now()
    where ledger.reserved_micro_usd<=${String(monthCap-BigInt(cost))}
    returning organization_id
  `;
  if(!month)return deny("test_bench_monetary_capacity_exceeded",429);
  return {
    rateCardId:card.id,reservedMicroUsd:cost,
    executionModel:source==="platform-nim"?models.find(x=>x.provider_code==="nim")!.model:null,
    judgeModel:models.find(x=>x.provider_code==="jev")!.model,
  };
}
/** A policy revocation, rate window expiry, or platform model drift before
 * outbound I/O denies the provider call, without refunding reserved budget.
 */
export async function assertMonetaryExecutionAuthorized(
  sql:Sql,
  row:{organization_id:string;rate_card_id:string|null;
    reserved_micro_usd:number|string;
    execution_model_pinned:string|null;judge_model_pinned:string|null;
    execution_source:"platform-nim"|"workspace-openai"},
  env:Env=process.env,
):Promise<void>{
  if(!monetaryAdmissionRequired(env))return;
  if(!row.rate_card_id||amount(row.reserved_micro_usd)===0n||
    !row.judge_model_pinned)
    return deny("test_bench_monetary_reservation_missing");
  const models=expectedMonetaryModels(row.execution_source,env);
  if(models.find(x=>x.provider_code==="jev")?.model!==row.judge_model_pinned||
    (row.execution_source==="platform-nim"&&
      models.find(x=>x.provider_code==="nim")?.model!==row.execution_model_pinned))
    return deny("test_bench_monetary_model_changed");
  const [eligible]=await sql<{allowed:boolean}[]>`
    select exists (
      select 1 from test_bench_tenant_monetary_policies p
        join test_bench_provider_rate_cards c on c.id=${row.rate_card_id}
      where p.organization_id=${row.organization_id} and p.enabled
        and c.status='approved' and c.valid_from<=now()
        and (c.valid_until is null or c.valid_until>now())
    ) as allowed
  `;
  if(!eligible?.allowed)return deny("test_bench_monetary_entitlement_revoked",403);
}
