import {randomUUID} from "node:crypto";
import type {Sql} from "postgres";
import {assertProviderRoleAdmission, ProviderRoleAdmissionError,
  type ProviderAdmissionReceipt, type ProviderInvocationRole,
  type ProviderCredentialMode} from "./provider-role-admission.ts";
import {quoteProviderCallMicroUsd, microUsdAsAdmissionNumber,
  ProviderRolePricingError, type ApprovedRoleRate} from "./provider-role-pricing.ts";

/** PER-1602 proposed durable store. Its tables are NOT deployed until PER-1592.
 * No HTTP endpoint calls this module. Server code must derive organization and
 * actor subject from a verified session, never a browser-authored JSON body.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
const MAX_MICRO=1_000_000_000_000n;
const permittedRoles=new Set<ProviderInvocationRole>(
  ["evaluation-executor","evaluation-judge","production-serving"]);
const permittedProviders=new Set(["openai","anthropic","azure-openai","openai-compatible"]);

export class ProviderRoleStoreError extends Error {
  readonly code:string;
  constructor(code:string){super(code);this.code=code;this.name="ProviderRoleStoreError";}
}
const deny=(code:string):never=>{throw new ProviderRoleStoreError(code);};
function str(value:unknown):string{
  if(typeof value!=="string"||!value.trim()||value.length>160)
    return deny("provider_role_store_invalid_record");
  return value;
}
function millis(value:Date|string|null):string|null{
  if(value===null)return null;
  const time=value instanceof Date?value:new Date(value);
  if(!Number.isFinite(time.getTime()))return deny("provider_role_store_invalid_record");
  return time.toISOString();
}
function micro(value:unknown):bigint{
  if((typeof value!=="string"||!/^(0|[1-9]\d{0,12})$/.test(value))&&
     (typeof value!=="bigint"||value<0n)&&
     (typeof value!=="number"||!Number.isSafeInteger(value)||value<0))
    return deny("provider_role_store_invalid_record");
  const n=BigInt(value as string|bigint|number);
  if(n>MAX_MICRO)return deny("provider_role_store_invalid_record");
  return n;
}
function validatedInput(input:ServerProviderCall):void{
  if(!input||!UUID.test(input.organizationId)||!UUID.test(input.runId)||
    !strInput(input.actorSubject,240)||!UUID.test(input.connectionId)||
    !permittedRoles.has(input.role)||!permittedProviders.has(input.provider)||
    !strInput(input.model,160)||!Number.isSafeInteger(input.callIndex)||
    input.callIndex<1||input.callIndex>1000||
    !Number.isSafeInteger(input.maxInputTokens)||input.maxInputTokens<1||
    !Number.isSafeInteger(input.maxOutputTokens)||input.maxOutputTokens<1||
    input.maxInputTokens+input.maxOutputTokens>1_000_000)
    deny("provider_role_request_invalid");
}
function strInput(v:unknown,max:number):boolean{
  return typeof v==="string"&&v.length>0&&v.trim().length>0&&v.length<=max;
}
export type ServerProviderCall={
  organizationId:string;actorSubject:string;connectionId:string;
  role:ProviderInvocationRole;provider:string;model:string;
  runId:string;callIndex:number;maxInputTokens:number;maxOutputTokens:number;
};
export type ProviderRoleReservation={
  reservationId:string;admission:ProviderAdmissionReceipt;
  reservedMicroUsd:string;providerUsage:"unobserved";
};

type DbRow={
 grantId:string;organizationId:string;connectionId:string;providerType:string;
 role:ProviderInvocationRole;model:string;credentialMode:ProviderCredentialMode;
 grantStatus:"draft"|"active"|"revoked";verifiedAt:Date|string|null;
 expiresAt:Date|string|null;billingOwner:string;pricingRevision:string;
 grantFingerprint:string;grantKeyVersion:number;
 maxTokensPerCall:number;maxMicroUsdPerCall:string|bigint|number;
 dailyCapMicroUsd:string|bigint|number;monthlyCapMicroUsd:string|bigint|number;
 connectionStatus:string;connectionAllowedModels:unknown;
 connectionFingerprint:string;connectionKeyVersion:number;
 actorSubject:string;actorUserId:string;actorStatus:string;
 rateStatus:ApprovedRoleRate["status"];rateSourceSha256:string;
 rateApprovedAt:Date|string|null;rateValidFrom:Date|string;
 rateValidUntil:Date|string|null;
 rateInputMicroUsdPerMillion:string|bigint;
 rateCacheWriteMicroUsdPerMillion:string|bigint;
 rateCacheReadMicroUsdPerMillion:string|bigint;
 rateOutputMicroUsdPerMillion:string|bigint;
 rateFixedMicroUsdPerCall:string|bigint;
};
function normalizeRow(row:DbRow,request:ServerProviderCall){
  if(row.organizationId!==request.organizationId||row.connectionId!==request.connectionId||
    row.providerType!==request.provider||row.role!==request.role||
    row.model!==request.model||row.actorSubject!==request.actorSubject||
    !UUID.test(row.actorUserId)||
    !UUID.test(row.grantId)||!HASH.test(row.grantFingerprint)||
    !HASH.test(row.connectionFingerprint)||
    !Array.isArray(row.connectionAllowedModels)||
    row.connectionAllowedModels.some(v=>typeof v!=="string"||v.length>160)||
    !Number.isSafeInteger(row.connectionKeyVersion)||row.connectionKeyVersion<1)
    return deny("provider_role_store_invalid_record");
  const allowedModels=row.connectionAllowedModels as string[];
  return {
    actor:{organizationId:row.organizationId,subject:row.actorSubject,
      status:row.actorStatus==="active"?"active" as const:"revoked" as const,
      permittedRoles:[row.role]},
    connection:{id:row.connectionId,organizationId:row.organizationId,
      provider:row.providerType,
      status:row.connectionStatus==="active"?"active" as const:"revoked" as const,
      credentialMode:row.credentialMode,secretFingerprint:row.connectionFingerprint,
      keyVersion:row.connectionKeyVersion,allowedModels},
    grant:{id:row.grantId,organizationId:row.organizationId,
      connectionId:row.connectionId,provider:row.providerType,
      role:row.role,model:row.model,credentialMode:row.credentialMode,
      secretFingerprint:row.grantFingerprint,keyVersion:row.grantKeyVersion,
      status:row.grantStatus==="active"?"active" as const:"revoked" as const,
      verifiedAt:millis(row.verifiedAt),expiresAt:millis(row.expiresAt),
      billingOwner:str(row.billingOwner),pricingRevision:str(row.pricingRevision),
      maxTokensPerCall:row.maxTokensPerCall,
      maxEstimatedUsdPerCall:microUsdAsAdmissionNumber(micro(row.maxMicroUsdPerCall))},
    rate:{provider:row.providerType,model:row.model,revision:row.pricingRevision,
      status:row.rateStatus,sourceSha256:row.rateSourceSha256,
      approvedAt:millis(row.rateApprovedAt),validFrom:millis(row.rateValidFrom)??"",
      validUntil:millis(row.rateValidUntil),
      inputMicroUsdPerMillion:row.rateInputMicroUsdPerMillion,
      cacheWriteMicroUsdPerMillion:row.rateCacheWriteMicroUsdPerMillion,
      cacheReadMicroUsdPerMillion:row.rateCacheReadMicroUsdPerMillion,
      outputMicroUsdPerMillion:row.rateOutputMicroUsdPerMillion,
      fixedMicroUsdPerCall:row.rateFixedMicroUsdPerCall} satisfies ApprovedRoleRate,
    dailyCapMicroUsd:micro(row.dailyCapMicroUsd),
    monthlyCapMicroUsd:micro(row.monthlyCapMicroUsd),
  };
}

/** Reserve once under DB transaction. Capacity includes all uncertain attempts.
 * If month/day/upstream state cannot be verified, rollback all changes.
 * No retry/resend path exists: an identical run/role/callIndex is rejected.
 */
export function createProviderRoleReservationStore(sql:Sql){
 return {
  async reserve(input:ServerProviderCall):Promise<ProviderRoleReservation>{
   validatedInput(input);
   try{
    return await sql.begin(async tx=>{
      const [row]=await tx<DbRow[]>`
       select g.id as "grantId",g.organization_id as "organizationId",
         g.connection_id as "connectionId",g.provider_type as "providerType",
         g.role,g.model,g.credential_mode as "credentialMode",g.status as "grantStatus",
         g.verified_at as "verifiedAt",g.expires_at as "expiresAt",
         g.billing_owner as "billingOwner",g.pricing_revision as "pricingRevision",
         g.secret_fingerprint as "grantFingerprint",g.key_version as "grantKeyVersion",
         g.max_tokens_per_call as "maxTokensPerCall",
         g.max_micro_usd_per_call as "maxMicroUsdPerCall",
         g.daily_cap_micro_usd as "dailyCapMicroUsd",
         g.monthly_cap_micro_usd as "monthlyCapMicroUsd",
         c.status as "connectionStatus",c.allowed_models as "connectionAllowedModels",
         s.secret_fingerprint as "connectionFingerprint",s.key_version as "connectionKeyVersion",
         u.external_subject as "actorSubject",u.id as "actorUserId",u.status as "actorStatus",
         r.status as "rateStatus",r.source_sha256 as "rateSourceSha256",
         r.approved_at as "rateApprovedAt",r.valid_from as "rateValidFrom",
         r.valid_until as "rateValidUntil",
         r.input_micro_usd_per_million as "rateInputMicroUsdPerMillion",
         r.cache_write_micro_usd_per_million as "rateCacheWriteMicroUsdPerMillion",
         r.cache_read_micro_usd_per_million as "rateCacheReadMicroUsdPerMillion",
         r.output_micro_usd_per_million as "rateOutputMicroUsdPerMillion",
         r.fixed_micro_usd_per_call as "rateFixedMicroUsdPerCall"
       from ai_provider_role_defaults d
       join ai_provider_role_grants g on g.organization_id=d.organization_id
         and g.id=d.grant_id and g.role=d.role
       join ai_connections c on c.organization_id=g.organization_id
         and c.id=g.connection_id and c.provider_type=g.provider_type
       join ai_connection_secrets s on s.ai_connection_id=c.id
       join ai_provider_role_rates r on r.provider_type=g.provider_type
         and r.model=g.model and r.revision=g.pricing_revision
       join users u on u.organization_id=d.organization_id
         and u.external_subject=${input.actorSubject} and u.status='active'
       join ai_provider_role_actor_grants a on a.organization_id=g.organization_id
         and a.grant_id=g.id and a.user_id=u.id
       where d.organization_id=${input.organizationId}
         and d.role=${input.role} and c.id=${input.connectionId}
         and g.provider_type=${input.provider} and g.model=${input.model}
         and g.status='active' and c.status='active' and r.status='approved'
         and g.verified_at<=now() and (g.expires_at is null or g.expires_at>now())
         and r.valid_from<=now() and (r.valid_until is null or r.valid_until>now())
       for share of d,g,c,s,r,u,a
      `;
      if(!row)return deny("provider_role_authority_unavailable");
      const verified=normalizeRow(row,input);
      const quote=quoteProviderCallMicroUsd({rate:verified.rate,
        provider:input.provider,model:input.model,revision:row.pricingRevision,
        maxInputTokens:input.maxInputTokens,maxOutputTokens:input.maxOutputTokens});
      const maxCall=micro(row.maxMicroUsdPerCall);
      if(quote>maxCall||quote>verified.dailyCapMicroUsd||quote>verified.monthlyCapMicroUsd)
        return deny("provider_role_budget_exceeded");
      const admission=assertProviderRoleAdmission({
        actor:verified.actor,connection:verified.connection,grant:verified.grant,
        supportedCredentialModes:["api-key"],
        intent:{organizationId:input.organizationId,connectionId:input.connectionId,
          provider:input.provider,role:input.role,model:input.model,
          secretFingerprint:row.connectionFingerprint,keyVersion:row.connectionKeyVersion,
          pricingRevision:row.pricingRevision,
          estimatedTokens:input.maxInputTokens+input.maxOutputTokens,
          estimatedUsd:microUsdAsAdmissionNumber(quote)}
      });
      const reservationId=randomUUID();
      const [created]=await tx<{id:string}[]>`
       insert into ai_provider_role_call_reservations(
        id,organization_id,grant_id,role,run_id,call_index,connection_id,actor_user_id,
        model,pricing_revision,reserved_micro_usd,estimated_tokens
       ) values(
        ${reservationId},${input.organizationId},${row.grantId},${input.role},
        ${input.runId},${input.callIndex},${input.connectionId},${row.actorUserId},
        ${input.model},${row.pricingRevision},${quote.toString()},
        ${input.maxInputTokens+input.maxOutputTokens}
       ) on conflict(organization_id,run_id,role,call_index) do nothing returning id
      `;
      if(!created)return deny("provider_role_call_already_reserved");
      // Lock order day => month. Both increments rollback with the reservation
      // if either policy ceiling is exceeded; no races from read-modify-write.
      const dayRemaining=(verified.dailyCapMicroUsd-quote).toString();
      const [day]=await tx<{reserved_micro_usd:string}[]>`
       insert into ai_provider_role_spend_days as ledger(
        organization_id,grant_id,utc_day,reserved_micro_usd
       ) values (${input.organizationId},${row.grantId},
        (now() at time zone 'UTC')::date,${quote.toString()})
       on conflict(organization_id,grant_id,utc_day) do update set
        reserved_micro_usd=ledger.reserved_micro_usd+${quote.toString()},updated_at=now()
       where ledger.reserved_micro_usd<=${dayRemaining}
       returning reserved_micro_usd
      `;
      if(!day)return deny("provider_role_daily_capacity_exceeded");
      const monthRemaining=(verified.monthlyCapMicroUsd-quote).toString();
      const [month]=await tx<{reserved_micro_usd:string}[]>`
       insert into ai_provider_role_spend_months as ledger(
        organization_id,grant_id,utc_month,reserved_micro_usd
       ) values (${input.organizationId},${row.grantId},
        date_trunc('month',now() at time zone 'UTC')::date,${quote.toString()})
       on conflict(organization_id,grant_id,utc_month) do update set
        reserved_micro_usd=ledger.reserved_micro_usd+${quote.toString()},updated_at=now()
       where ledger.reserved_micro_usd<=${monthRemaining}
       returning reserved_micro_usd
      `;
      if(!month)return deny("provider_role_monthly_capacity_exceeded");
      return {reservationId,admission,reservedMicroUsd:quote.toString(),
        providerUsage:"unobserved" as const};
    });
   }catch(error){
    if(error instanceof ProviderRoleStoreError||error instanceof ProviderRoleAdmissionError||
       error instanceof ProviderRolePricingError)throw error;
    // SQL errors (including pending schema, provider revocation, DB outage) are
    // sanitized; no external request is authorized by an unavailable store.
    return deny("provider_role_store_unavailable");
   }
  }
 };
}
