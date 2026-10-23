import assert from "node:assert/strict";
import test from "node:test";
import type {Sql} from "postgres";
import {createProviderRoleDispatchGate, type DispatchBoundCall} from "./provider-role-dispatch.ts";
import {ProviderRoleStoreError} from "./provider-role-store.ts";
const input:DispatchBoundCall={
 organizationId:"11111111-1111-4111-8111-111111111111",actorSubject:"auth0|owner",
 reservationId:"44444444-4444-4444-8444-444444444444",
 connectionId:"22222222-2222-4222-8222-222222222222",
 provider:"anthropic",model:"claude-test-v1",
};
const baseline={id:input.reservationId,organizationId:input.organizationId,
 connectionId:input.connectionId,providerType:input.provider,model:input.model,
 grantId:"55555555-5555-4555-8555-555555555555",role:"evaluation-executor",
 actorSubject:input.actorSubject,reservationState:"reserved",pricingRevision:"rate-v1",
 rateStatus:"approved",grantFingerprint:"a".repeat(64),grantKeyVersion:2,
 secretFingerprint:"a".repeat(64),secretKeyVersion:2,
 verifiedAt:"2020-01-01T00:00:00Z",expiresAt:"2099-01-01T00:00:00Z"};
const denied=(code:string)=>(e:unknown)=>e instanceof ProviderRoleStoreError&&e.code===code;
function fake(row:typeof baseline|null=baseline){
 let state="reserved", updates=0, reads=0;
 const begin=async<T>(run:(query:(strings:TemplateStringsArray,...values:unknown[])=>Promise<unknown[]>)=>Promise<T>):Promise<T>=>{
  const previousState=state;
  try{return await run(async(strings:TemplateStringsArray,...values:unknown[])=>{
   const sql=strings.join("?").toLowerCase();
   if(sql.includes("from ai_provider_role_call_reservations cr")){
    reads++;
    if(!row||state!=="reserved"||values[0]!==input.actorSubject||
     values[1]!==input.reservationId||values[2]!==input.organizationId||
     values[3]!==input.connectionId||values[4]!==input.model||
     values[5]!==input.provider)return [];
    return [row];
   }
   if(sql.includes("update ai_provider_role_call_reservations")){
    if(state!=="reserved")return [];
    state="dispatching";updates++;
    return [{id:values[0]}];
   }
   throw Error("Unexpected SQL");
  });}catch(error){state=previousState;throw error;}
 };
 return {sql:{begin} as unknown as Sql,reads:()=>reads,updates:()=>updates};
}
test("PER-1602 commits exactly one dispatch only with current key fingerprint",async()=>{
 const db=fake();const gate=createProviderRoleDispatchGate(db.sql);
 const receipt=await gate.beginDispatch(input);
 assert.deepEqual(receipt,{reservationId:input.reservationId,state:"dispatching",
   credentialFingerprint:"a".repeat(64),keyVersion:2});
 await assert.rejects(()=>gate.beginDispatch(input),denied("provider_dispatch_authority_changed"));
 assert.equal(db.updates(),1);
});
test("PER-1602 foreign actor/tenant/role and revoked grant cannot dispatch",async()=>{
 for(const changes of [{organizationId:"66666666-6666-4666-8666-666666666666"},
  {actorSubject:"auth0|attacker"},{connectionId:"66666666-6666-4666-8666-666666666666"},
  {provider:"openai"},{model:"unexpected-model"}]){
  const db=fake();const gate=createProviderRoleDispatchGate(db.sql);
  await assert.rejects(()=>gate.beginDispatch({...input,...changes}),
   denied("provider_dispatch_authority_changed"));
  assert.equal(db.updates(),0);
 }
 const forged=fake({...baseline,secretFingerprint:"b".repeat(64)});
 await assert.rejects(()=>createProviderRoleDispatchGate(forged.sql).beginDispatch(input),
  denied("provider_dispatch_authority_changed"));
 assert.equal(forged.updates(),0);
 const unknown=fake(null);
 await assert.rejects(()=>createProviderRoleDispatchGate(unknown.sql).beginDispatch(input),
  denied("provider_dispatch_authority_changed"));
});
test("PER-1602 bad IDs and missing DB cannot authorize a provider call",async()=>{
 const db=fake();const gate=createProviderRoleDispatchGate(db.sql);
 await assert.rejects(()=>gate.beginDispatch({...input,reservationId:"bad"}),
  denied("provider_dispatch_request_invalid"));
 assert.equal(db.reads(),0);
 const outage=createProviderRoleDispatchGate({begin:async()=>{throw Error("PRIVATE SQL")}} as unknown as Sql);
 await assert.rejects(()=>outage.beginDispatch(input),error=>
   denied("provider_dispatch_store_unavailable")(error)&&!String(error).includes("PRIVATE SQL"));
});
