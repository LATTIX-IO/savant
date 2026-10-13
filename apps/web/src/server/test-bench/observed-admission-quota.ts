import type {Sql,TransactionSql} from "postgres";
import {MAX_OBSERVED_TOKENS} from "./observed-evaluator.ts";
import {TestBenchError} from "./definition-contract.ts";

/** Conservative, fixed server-side MVP contract; a future policy/entitlements
 * increment can replace this with audited per-plan caps. This does NOT cap actual
 * provider spend, output billing, or tokens consumed by a running request.
 */
export const DAILY_OBSERVED_RUN_LIMIT=10;
export const DAILY_NORMALIZED_TOKEN_LIMIT=120_000;
export const NORMALIZED_UNITS_PER_RUN=MAX_OBSERVED_TOKENS;
export type DailyAdmissionQuota={
  utcDay:string;resetAtUtc:string;
  dailyRunLimit:number;admittedRuns:number;remainingRuns:number;
  dailyNormalizedTokenLimit:number;reservedNormalizedTokens:number;
  remainingNormalizedTokens:number;releasesOnCancel:false;
  accounting:"normalized-admission-reservation";
};
type QuotaRow={
  utc_day:string;reset_at_utc:string;
  admitted_runs:number;reserved_normalized_tokens:number;
};
export function publicAdmissionQuota(row:QuotaRow):DailyAdmissionQuota{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(row.utc_day)||
    !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(row.reset_at_utc)||
    !Number.isSafeInteger(row.admitted_runs)||
    row.admitted_runs<0||row.admitted_runs>DAILY_OBSERVED_RUN_LIMIT||
    row.reserved_normalized_tokens!==row.admitted_runs*NORMALIZED_UNITS_PER_RUN){
    throw new TestBenchError("test_bench_quota_integrity_invalid",503);
  }
  return {
    utcDay:row.utc_day,resetAtUtc:row.reset_at_utc,
    dailyRunLimit:DAILY_OBSERVED_RUN_LIMIT,
    admittedRuns:row.admitted_runs,
    remainingRuns:DAILY_OBSERVED_RUN_LIMIT-row.admitted_runs,
    dailyNormalizedTokenLimit:DAILY_NORMALIZED_TOKEN_LIMIT,
    reservedNormalizedTokens:row.reserved_normalized_tokens,
    remainingNormalizedTokens:DAILY_NORMALIZED_TOKEN_LIMIT-row.reserved_normalized_tokens,
    releasesOnCancel:false,
    accounting:"normalized-admission-reservation",
  };
}
/** A single INSERT...ON CONFLICT...WHERE is the linearizable quota gate.
 * Call only AFTER the idempotency check and BEFORE job admission in the SAME
 * transaction. Never refund for unconfirmed external side effects.
 */
export async function reserveDailyAdmission(tx:TransactionSql,organizationId:string):
 Promise<void>{
  const rows=await tx<{organization_id:string}[]>`
    insert into test_bench_daily_admissions as admissions(
      organization_id,utc_day,admitted_runs,reserved_normalized_tokens
    ) values (
      ${organizationId}, (now() at time zone 'UTC')::date, 1,
      ${NORMALIZED_UNITS_PER_RUN}
    )
    on conflict (organization_id,utc_day) do update set
      admitted_runs=admissions.admitted_runs+1,
      reserved_normalized_tokens=admissions.reserved_normalized_tokens+
        ${NORMALIZED_UNITS_PER_RUN},
      updated_at=now()
    where admissions.admitted_runs < ${DAILY_OBSERVED_RUN_LIMIT}
      and admissions.reserved_normalized_tokens <=
        ${DAILY_NORMALIZED_TOKEN_LIMIT-NORMALIZED_UNITS_PER_RUN}
    returning organization_id
  `;
  if(rows.length!==1)
    throw new TestBenchError("test_bench_daily_quota_exceeded",429);
}
export async function readDailyAdmissionQuota(sql:Sql,organizationId:string):
 Promise<DailyAdmissionQuota>{
  const [row]=await sql<QuotaRow[]>`
    select to_char(bucket.day,'YYYY-MM-DD') as utc_day,
      (to_char(bucket.day+1,'YYYY-MM-DD') || 'T00:00:00.000Z') as reset_at_utc,
      coalesce(ledger.admitted_runs,0)::int as admitted_runs,
      coalesce(ledger.reserved_normalized_tokens,0)::int as reserved_normalized_tokens
    from (select (now() at time zone 'UTC')::date as day) bucket
    left join test_bench_daily_admissions ledger
      on ledger.organization_id=${organizationId} and ledger.utc_day=bucket.day
  `;
  if(!row)throw new TestBenchError("test_bench_quota_unavailable",503);
  return publicAdmissionQuota(row);
}
