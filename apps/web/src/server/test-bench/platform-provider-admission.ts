import type {TransactionSql} from "postgres";
import {TestBenchError} from "./definition-contract.ts";

/** Shared provider admission ceiling; not an actual token or dollar budget.
 * Both execution modes use the platform judge. Only platform mode uses NIM.
 */
export const PLATFORM_PROVIDER_DAILY_LIMITS={jev:200,nim:100} as const;
export const PLATFORM_PROVIDER_RESERVATION_UNITS=12000;
export type PlatformProvider="jev"|"nim";
export function providersForObservedSource(source:"platform-nim"|"workspace-openai"):
 readonly PlatformProvider[]{
  if(source==="platform-nim")return ["jev","nim"];
  if(source==="workspace-openai")return ["jev"];
  throw new TestBenchError("test_bench_execution_source_invalid",422);
}
/** Call once inside the SAME transaction as tenant reservation and queue
 * insertion, after request-id replay checks. Acquire locks Jev then NIM.
 */
export async function reservePlatformProviderAdmission(
  tx:TransactionSql,source:"platform-nim"|"workspace-openai",
):Promise<void>{
  for(const provider of providersForObservedSource(source)){
    const cap=PLATFORM_PROVIDER_DAILY_LIMITS[provider];
    const inserted=await tx<{provider_code:string}[]>`
      insert into test_bench_platform_provider_daily_admissions as ledger(
        provider_code,utc_day,admitted_runs,reserved_normalized_tokens
      ) values(
        ${provider},(now() at time zone 'UTC')::date,1,
        ${PLATFORM_PROVIDER_RESERVATION_UNITS}
      ) on conflict(provider_code,utc_day) do update set
        admitted_runs=ledger.admitted_runs+1,
        reserved_normalized_tokens=ledger.reserved_normalized_tokens+
          ${PLATFORM_PROVIDER_RESERVATION_UNITS},
        updated_at=now()
      where ledger.admitted_runs < ${cap}
        and ledger.reserved_normalized_tokens <=
          ${(cap-1)*PLATFORM_PROVIDER_RESERVATION_UNITS}
      returning provider_code
    `;
    if(inserted.length!==1)
      throw new TestBenchError("test_bench_platform_capacity_exceeded",429);
  }
}
