import type {Sql} from "postgres";
import {ProviderRoleStoreError} from "./provider-role-store.ts";

/** Single-use pre-network gate: only the original reserved actor may commit a
 * dispatch. No replay, no key rotation bypass, no cross-role substitution.
 * Store read and transition run inside one DB transaction. This gate must be
 * called immediately before model HTTP, with all inputs from server state.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^[0-9a-f]{64}$/;
export type DispatchBoundCall={
 organizationId:string;actorSubject:string;reservationId:string;
 connectionId:string;provider:string;model:string;
};
type Row={
 id:string;organizationId:string;connectionId:string;grantId:string;
 providerType:string;model:string;role:string;actorSubject:string;
 reservationState:string;pricingRevision:string;rateStatus:string;
 grantFingerprint:string;grantKeyVersion:number;
 secretFingerprint:string;secretKeyVersion:number;
 verifiedAt:Date|string|null;expiresAt:Date|string|null;
};
const fail=(code:string):never=>{throw new ProviderRoleStoreError(code);};
export function createProviderRoleDispatchGate(sql:Sql){
 return {
  async beginDispatch(input:DispatchBoundCall):Promise<{reservationId:string;state:"dispatching";credentialFingerprint:string;keyVersion:number}> {
   if(!input||!UUID.test(input.organizationId)||!UUID.test(input.reservationId)||
      !UUID.test(input.connectionId)||typeof input.actorSubject!=="string"||
      !input.actorSubject.trim()||input.actorSubject.length>240||
      !["openai","anthropic","azure-openai","openai-compatible"].includes(input.provider)||
      typeof input.model!=="string"||!input.model.trim()||input.model.length>160)
     return fail("provider_dispatch_request_invalid");
   try{
    return await sql.begin(async tx=>{
     const [row]=await tx<Row[]>`
      select cr.id,cr.organization_id as "organizationId",
        cr.connection_id as "connectionId",cr.grant_id as "grantId",
        g.provider_type as "providerType",cr.model,cr.role,
        cr.state as "reservationState",cr.pricing_revision as "pricingRevision",
        u.external_subject as "actorSubject",rate.status as "rateStatus",
        g.secret_fingerprint as "grantFingerprint",g.key_version as "grantKeyVersion",
        s.secret_fingerprint as "secretFingerprint",s.key_version as "secretKeyVersion",
        g.verified_at as "verifiedAt",g.expires_at as "expiresAt"
      from ai_provider_role_call_reservations cr
      join ai_provider_role_grants g on g.organization_id=cr.organization_id
        and g.id=cr.grant_id and g.role=cr.role
      join ai_provider_role_defaults d on d.organization_id=g.organization_id
        and d.role=g.role and d.grant_id=g.id
      join ai_connections c on c.organization_id=g.organization_id
        and c.id=g.connection_id and c.provider_type=g.provider_type
      join ai_connection_secrets s on s.ai_connection_id=c.id
      join ai_provider_role_rates rate on rate.provider_type=g.provider_type
        and rate.model=g.model and rate.revision=g.pricing_revision
      join users u on u.organization_id=g.organization_id and u.status='active'
        and u.external_subject=${input.actorSubject} and u.id=cr.actor_user_id
      join ai_provider_role_actor_grants a on a.organization_id=g.organization_id
        and a.grant_id=g.id and a.user_id=u.id
      where cr.id=${input.reservationId} and cr.organization_id=${input.organizationId}
        and cr.connection_id=${input.connectionId} and cr.model=${input.model}
        and g.provider_type=${input.provider}
        and cr.pricing_revision=g.pricing_revision
        and cr.state='reserved' and g.status='active' and c.status='active'
        and g.verified_at<=now() and (g.expires_at is null or g.expires_at>now())
        and rate.status='approved' and rate.valid_from<=now()
        and (rate.valid_until is null or rate.valid_until>now())
      for update of cr
      for share of g,d,c,s,rate,u,a
     `;
     if(!row||row.id!==input.reservationId||row.organizationId!==input.organizationId||
        row.connectionId!==input.connectionId||row.providerType!==input.provider||
        row.model!==input.model||row.actorSubject!==input.actorSubject||
        row.reservationState!=="reserved"||row.rateStatus!=="approved"||
        !HASH.test(row.grantFingerprint)||row.grantFingerprint!==row.secretFingerprint||
        !Number.isSafeInteger(row.grantKeyVersion)||row.grantKeyVersion<1||
        row.grantKeyVersion!==row.secretKeyVersion)
       return fail("provider_dispatch_authority_changed");
     const [updated]=await tx<{id:string}[]>`
       update ai_provider_role_call_reservations
       set state='dispatching',dispatched_at=now()
       where id=${input.reservationId} and organization_id=${input.organizationId}
         and state='reserved' returning id
     `;
     if(!updated||updated.id!==input.reservationId)
       return fail("provider_dispatch_already_used");
     return {reservationId:updated.id,state:"dispatching" as const,
       credentialFingerprint:row.secretFingerprint,keyVersion:row.secretKeyVersion};
    });
   }catch(error){
     if(error instanceof ProviderRoleStoreError)throw error;
     return fail("provider_dispatch_store_unavailable");
   }
  },
 };
}
