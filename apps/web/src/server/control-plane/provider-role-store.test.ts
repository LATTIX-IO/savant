import test from "node:test";
import assert from "node:assert/strict";
import {createProviderRoleReservationStore,ProviderRoleStoreError,
  type ServerProviderCall} from "./provider-role-store.ts";
import type {Sql} from "postgres";
const org="11111111-1111-4111-8111-111111111111";
const conn="22222222-2222-4222-8222-222222222222";
const run="33333333-3333-4333-8333-333333333333";
const fp="a".repeat(64);
const row={
 grantId:"44444444-4444-4444-8444-444444444444",organizationId:org,
 connectionId:conn,providerType:"anthropic",role:"evaluation-executor",model:"claude-test-v1",
 credentialMode:"api-key",grantStatus:"active",verifiedAt:"2020-01-01T00:00:00Z",
 expiresAt:"2099-01-01T00:00:00Z",billingOwner:"qa-project",pricingRevision:"approved-v1",
 grantFingerprint:fp,grantKeyVersion:2,maxTokensPerCall:2000,maxMicroUsdPerCall:"5000",
 dailyCapMicroUsd:"6500",monthlyCapMicroUsd:"10000",
 connectionStatus:"active",connectionAllowedModels:["claude-test-v1"],
 connectionFingerprint:fp,connectionKeyVersion:2,actorSubject:"auth0|fixture",
 actorUserId:"66666666-6666-4666-8666-666666666666",actorStatus:"active",
 rateStatus:"approved",rateSourceSha256:"b".repeat(64),rateApprovedAt:"2020-01-01T00:00:00Z",
 rateValidFrom:"2020-01-01T00:00:00Z",rateValidUntil:"2099-01-01T00:00:00Z",
 rateInputMicroUsdPerMillion:"1000000",rateCacheWriteMicroUsdPerMillion:"2000000",
 rateCacheReadMicroUsdPerMillion:"100000",rateOutputMicroUsdPerMillion:"5000000",
 rateFixedMicroUsdPerCall:"100",
};
const input:ServerProviderCall={organizationId:org,actorSubject:"auth0|fixture",connectionId:conn,
 role:"evaluation-executor",provider:"anthropic",model:"claude-test-v1",runId:run,
 callIndex:1,maxInputTokens:1000,maxOutputTokens:400};
const fails=(code:string)=>(e:unknown)=>e instanceof ProviderRoleStoreError&&e.code===code;

function database(authority:typeof row|null=row){
 const state={reservation:new Set<string>(),day:new Map<string,bigint>(),month:new Map<string,bigint>()};
 let ops:string[]=[];let currentDay="2026-10-22";let loadCount=0;
 let lock=Promise.resolve();
 const begin=async<T>(fn:(tx:(strings:TemplateStringsArray,...values:unknown[])=>Promise<unknown[]>)=>Promise<T>):Promise<T>=>{
  let unlock!:()=>void;
  const previous=lock;
  lock=new Promise<void>(resolve=>{unlock=resolve;});
  await previous;
  const prior={reservation:new Set(state.reservation),day:new Map(state.day),month:new Map(state.month)};
  const tx=async(strings:TemplateStringsArray,...values:unknown[])=>{
   const query=strings.join("?").toLowerCase();
   if(query.includes("from ai_provider_role_defaults d")){
    ops.push("load");loadCount++;
    if(!authority || values[0]!==authority.actorSubject || values[1]!==authority.organizationId ||
       values[2]!==authority.role || values[3]!==authority.connectionId ||
       values[4]!==authority.providerType || values[5]!==authority.model) return [];
    return [authority];
   }
   if(query.includes("insert into ai_provider_role_call_reservations")){
    ops.push("reserve");
    const key=[values[1],values[4],values[3],values[5]].join("/");
    if(state.reservation.has(key))return [];
    state.reservation.add(key);return [{id:values[0]}];
   }
   if(query.includes("insert into ai_provider_role_spend_days")){
    ops.push("day");
    const key=currentDay;
    const old=state.day.get(key)??0n;
    const add=BigInt(values[2] as string);
    const allowed=BigInt(values[4] as string)+add;
    if(old+add>allowed)return [];
    state.day.set(key,old+add);return [{reserved_micro_usd:String(old+add)}];
   }
   if(query.includes("insert into ai_provider_role_spend_months")){
    ops.push("month");
    const old=state.month.get("2026-10")??0n;
    const add=BigInt(values[2] as string);
    const allowed=BigInt(values[4] as string)+add;
    if(old+add>allowed)return [];
    state.month.set("2026-10",old+add);return [{reserved_micro_usd:String(old+add)}];
   }
   throw Error("Unexpected SQL from server module");
  };
  try {return await fn(tx);}catch(e){
   state.reservation=prior.reservation;state.day=prior.day;state.month=prior.month;
   throw e;
  }finally{unlock();}
 };
 return {sql:{begin} as unknown as Sql,state,
  events:()=>ops,reads:()=>loadCount,nextDay:()=>{const d=new Date(currentDay+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+1);currentDay=d.toISOString().slice(0,10);},
  resetEvents:()=>{ops=[];}};
}

test("PER-1602 authenticated role and approved rate reserve cumulative daily/monthly budget",async()=>{
 const db=database();const store=createProviderRoleReservationStore(db.sql);
 const result=await store.reserve(input);
 assert.equal(result.admission.provider,"anthropic");
 assert.equal(result.admission.role,"evaluation-executor");
 assert.equal(result.providerUsage,"unobserved");
 assert.equal(result.reservedMicroUsd,"4100"); // upper bound 2000+2000+100
 assert.deepEqual(db.events(),["load","reserve","day","month"]);
 assert.equal(db.state.day.get("2026-10-22"),4100n);
 await assert.rejects(()=>store.reserve(input),fails("provider_role_call_already_reserved"));
 assert.equal(db.state.month.get("2026-10"),4100n);
});
test("PER-1602 deny unauthenticated, forged, unsupported identity before SQL",async()=>{
 const db=database();const store=createProviderRoleReservationStore(db.sql);
 for(const invalid of [{...input,organizationId:"foreign"},
   {...input,runId:"not-uuid"},{...input,actorSubject:""},
   {...input,role:"admin-everything" as ServerProviderCall["role"]},
   {...input,maxOutputTokens:0}])
  await assert.rejects(()=>store.reserve(invalid),fails("provider_role_request_invalid"));
 assert.deepEqual(db.events(),[]);
});
test("PER-1602 foreign tenant, actor, role, model, grant default absence deny before capacity",async()=>{
 const db=database();const store=createProviderRoleReservationStore(db.sql);
 for(const invalid of [
  {...input,actorSubject:"auth0|offboarded"},{...input,organizationId:"55555555-5555-4555-8555-555555555555"},
  {...input,connectionId:"55555555-5555-4555-8555-555555555555"},
  {...input,role:"production-serving" as const}, {...input,model:"other"}
 ]) await assert.rejects(()=>store.reserve(invalid),fails("provider_role_authority_unavailable"));
 assert.equal(db.state.reservation.size,0);
});
test("PER-1602 persistent capacity never refills for unacknowledged provider calls",async()=>{
 const db=database();const store=createProviderRoleReservationStore(db.sql);
 await store.reserve(input);
 await assert.rejects(()=>store.reserve({...input,callIndex:2}),
   fails("provider_role_daily_capacity_exceeded"));
 assert.equal(db.state.reservation.size,1,"failed second intent rolled back");
 assert.equal(db.state.day.get("2026-10-22"),4100n);
 db.nextDay();
 await store.reserve({...input,callIndex:3});
 assert.equal(db.state.month.get("2026-10"),8200n);
 db.nextDay();
 await assert.rejects(()=>store.reserve({...input,callIndex:4}),
   fails("provider_role_monthly_capacity_exceeded"));
 assert.equal(db.state.month.get("2026-10"),8200n);
 assert.equal(db.state.day.get("2026-10-23"),4100n);
 assert.equal(db.state.reservation.size,2);
});
test("PER-1602 concurrent identical reservations have at-most-one admitted invocation",async()=>{
 const db=database();const store=createProviderRoleReservationStore(db.sql);
 const settled=await Promise.allSettled([store.reserve(input),store.reserve(input)]);
 assert.equal(settled.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(settled.filter(x=>x.status==="rejected").length,1);
 assert.equal(db.state.reservation.size,1);
 assert.equal(db.state.month.get("2026-10"),4100n);
});
test("PER-1602 missing schema, malformed price and revoked grant stop before reservation",async()=>{
 const db=database({...row,connectionFingerprint:"b".repeat(64)});
 await assert.rejects(()=>createProviderRoleReservationStore(db.sql).reserve(input),
  e=>e instanceof Error&&e.message==="provider_grant_credential_changed");
 assert.equal(db.state.reservation.size,0);
 const missing=database(null);
 await assert.rejects(()=>createProviderRoleReservationStore(missing.sql).reserve(input),
  fails("provider_role_authority_unavailable"));
 const outage=createProviderRoleReservationStore({begin:async()=>{throw new Error("private DB URL")}} as unknown as Sql);
 await assert.rejects(()=>outage.reserve(input),e=>fails("provider_role_store_unavailable")(e)&&
  !String(e).includes("private DB URL"));
});
