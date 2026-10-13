import {withWorkspaceSlugQuery} from "./tenant-paths.ts";
import type {DailyAdmissionQuota} from "../server/test-bench/observed-admission-quota.ts";

export class DailyQuotaClientError extends Error{
  constructor(message:string){super(message);this.name="DailyQuotaClientError";}
}
function parseQuota(value:unknown):DailyAdmissionQuota{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new DailyQuotaClientError("Invalid Test Bench quota response.");
  const v=value as Record<string,unknown>;
  if(v.accounting!=="normalized-admission-reservation"||
    v.releasesOnCancel!==false||
    v.dailyRunLimit!==10||v.dailyNormalizedTokenLimit!==120000||
    !Number.isSafeInteger(v.admittedRuns)||
    (v.admittedRuns as number)<0||(v.admittedRuns as number)>10||
    v.remainingRuns!==10-(v.admittedRuns as number)||
    v.reservedNormalizedTokens!==(v.admittedRuns as number)*12000||
    v.remainingNormalizedTokens!==120000-(v.admittedRuns as number)*12000||
    typeof v.utcDay!=="string"||
    !/^\d{4}-\d{2}-\d{2}$/.test(v.utcDay)||
    typeof v.resetAtUtc!=="string"||
    !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(v.resetAtUtc))
    throw new DailyQuotaClientError("Test Bench quota provenance is invalid.");
  return v as DailyAdmissionQuota;
}
/** Authenticated, tenant-scoped metadata. Never includes provider secrets,
 * model prompts, inferred costs or the tenant's actual bill.
 */
export async function readObservedDailyQuota(
  workspaceSlug:string,options:{fetcher?:typeof fetch;signal?:AbortSignal}={},
):Promise<DailyAdmissionQuota>{
  if(typeof workspaceSlug!=="string"||workspaceSlug.length>80||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(workspaceSlug))
    throw new DailyQuotaClientError("Invalid workspace.");
  const url=withWorkspaceSlugQuery("/api/test-bench/quota",workspaceSlug);
  const response=await (options.fetcher??fetch)(url,{
    method:"GET",mode:"same-origin",credentials:"same-origin",
    cache:"no-store",headers:{"Accept":"application/json"},
    signal:options.signal??null,
  });
  if(!response.ok)throw new DailyQuotaClientError("Quota service unavailable.");
  let result:unknown;
  try{result=await response.json();}
  catch{throw new DailyQuotaClientError("Malformed quota response.");}
  if(!result||typeof result!=="object"||Array.isArray(result))
    throw new DailyQuotaClientError("Malformed quota response.");
  return parseQuota((result as Record<string,unknown>).data);
}
