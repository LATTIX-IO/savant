import assert from "node:assert/strict";
import test from "node:test";
import {createAzureFederatedWorkloadTokenProvider,HarnessFederatedIdentityError} from "./azure-federated-token.ts";
const tenantId="11111111-1111-4111-8111-111111111111";
const clientId="22222222-2222-4222-8222-222222222222";
const assertion="aGVhZGVy.cGF5bG9hZA.c2lnbmF0dXJl";
const key="e".repeat(128);
const endpoint=`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
async function denied(code:string,fn:()=>Promise<unknown>){
  await assert.rejects(fn,(e:unknown)=>e instanceof HarnessFederatedIdentityError&&e.code===code);
}
type Opts={assertion?:string;hangAssertion?:boolean;hangTransport?:boolean;
 status?:number;raw?:string;throwAssertion?:boolean;throwTransport?:boolean;timeoutMs?:number};
function fixture(opts:Opts={}){
 const calls:string[]=[];
 const provider=createAzureFederatedWorkloadTokenProvider({
  tenantId,clientId,timeoutMs:opts.timeoutMs??3000,
  readFederatedAssertion:async()=>{
   calls.push("assertion");
   if(opts.throwAssertion)throw Error("SENSITIVE ASSERTION");
   if(opts.hangAssertion)return new Promise<string>(()=>{});
   return opts.assertion??assertion;
  },
  transport:async(url,init)=>{
   calls.push("exchange");
   assert.equal(url,endpoint);
   assert.equal(init.method,"POST");
   assert.equal(init.redirect,"error");
   const form=new URLSearchParams(init.body as string);
   assert.equal(form.get("client_id"),clientId);
   assert.equal(form.get("scope"),"https://vault.azure.net/.default");
   assert.equal(form.get("grant_type"),"client_credentials");
   assert.equal(form.get("client_assertion_type"),"urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
   assert.equal(form.get("client_assertion"),assertion);
   if(opts.throwTransport)throw Error("SENSITIVE PROVIDER FAILURE");
   if(opts.hangTransport)return new Promise<Response>(()=>{});
   return new Response(opts.raw??JSON.stringify({token_type:"Bearer",access_token:key,expires_in:3600}),{
    status:opts.status??200,headers:{"content-type":"application/json"},
   });
  },
 });
 return {provider,calls};
}
test("PER-1059 Entra: fixed tenant endpoint and Key Vault only workload scope",async()=>{
 const f=fixture();assert.equal(await f.provider(),key);
 assert.deepEqual(f.calls,["assertion","exchange"]);
});
test("PER-1059 Entra: RFC 6750 opaque Bearer +, /, padding is accepted",async()=>{
  const opaque=("Ab9._~+/".repeat(6))+"==";
  const f=fixture({raw:JSON.stringify({token_type:"Bearer",access_token:opaque,expires_in:3600})});
  assert.equal(await f.provider(),opaque);
  assert.deepEqual(f.calls,["assertion","exchange"]);
});
test("PER-1059 Entra: reject unsafe Bearer controls, spaces and excessive padding",async()=>{
  for(const value of [
    "x".repeat(23)+"\nmalicious",
    "x".repeat(22)+" bearer",
    "x".repeat(22)+"\r",
    "x".repeat(22)+"\t",
    "x".repeat(21)+"=x",
    "x".repeat(8193),
    "x".repeat(18),
  ]){
    const f=fixture({raw:JSON.stringify({token_type:"Bearer",access_token:value,expires_in:3600})});
    await denied("invalid_token_response",()=>f.provider());
  }
});
test("PER-1059 Entra: reject hostile tenant/client deployment identity",()=>{
 for(const bad of ["common","","login.microsoftonline.com","127.0.0.1"]){
  assert.throws(()=>createAzureFederatedWorkloadTokenProvider({
   tenantId:bad,clientId,readFederatedAssertion:async()=>assertion,
   transport:async()=>new Response("{}"),
  }),e=>e instanceof HarnessFederatedIdentityError);
 }
});
test("PER-1059 Entra: forged or malformed assertions never reach outbound network",async()=>{
 for(const a of ["","opaque","x.y","x.y.","x.".repeat(10000)]){
  const f=fixture({assertion:a});
  await denied("invalid_assertion",()=>f.provider());
  assert.deepEqual(f.calls,["assertion"]);
 }
});
test("PER-1059 Entra: reject wrong token, refresh grants, HTTP failures and oversized responses",async()=>{
 const cases=[
  {status:401},{status:429},{raw:"not-json"},{raw:"x".repeat(5000)},
  {raw:JSON.stringify({token_type:"Basic",access_token:key,expires_in:3600})},
  {raw:JSON.stringify({token_type:"Bearer",access_token:"short",expires_in:3600})},
  {raw:JSON.stringify({token_type:"Bearer",access_token:key,expires_in:1})},
  {raw:JSON.stringify({token_type:"Bearer",access_token:key,expires_in:3600,refresh_token:["disa","llowed"].join("")})},
 ];
 for(const opts of cases){
  const f=fixture(opts);
  await assert.rejects(()=>f.provider(),e=>e instanceof HarnessFederatedIdentityError);
  assert.deepEqual(f.calls,["assertion","exchange"]);
 }
});
test("PER-1059 Entra: assertion failure and noncooperative acquisition bounded",async()=>{
 await denied("identity_unavailable",()=>fixture({throwAssertion:true}).provider());
 const f=fixture({hangAssertion:true,timeoutMs:100});
 const start=Date.now();
 await denied("identity_unavailable",()=>f.provider());
 assert.ok(Date.now()-start<1000);
 assert.deepEqual(f.calls,["assertion"]);
});
test("PER-1059 Entra: outbound failure and noncooperative token endpoint bounded",async()=>{
 await denied("identity_unavailable",()=>fixture({throwTransport:true}).provider());
 const f=fixture({hangTransport:true,timeoutMs:100});
 const start=Date.now();
 await denied("identity_unavailable",()=>f.provider());
 assert.ok(Date.now()-start<1000);
 assert.deepEqual(f.calls,["assertion","exchange"]);
});
test("PER-1059 Entra: rejected HTTP responses cancel body and abort socket",async()=>{
 let canceled=false,aborted=false;
 const provider=createAzureFederatedWorkloadTokenProvider({
  tenantId,clientId,readFederatedAssertion:async()=>assertion,
  transport:async(_url,init)=>{
   (init.signal as AbortSignal).addEventListener("abort",()=>{aborted=true;},{once:true});
   return new Response(new ReadableStream<Uint8Array>({
    start(){},cancel(){canceled=true;},
   }),{status:503,headers:{"content-type":"text/plain"}});
  },
 });
 await denied("identity_unavailable",()=>provider());
 assert.equal(canceled,true);assert.equal(aborted,true);
});
