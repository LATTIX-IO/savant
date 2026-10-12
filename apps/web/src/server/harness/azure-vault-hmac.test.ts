import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {createAzureKeyVaultHarnessResolver,HarnessAzureVaultError} from "./azure-vault-hmac.ts";

const tenant="11111111-1111-4111-8111-111111111111";
const adapter="sandbox-adapter";
const alias="harness-hmac";
const version="f".repeat(32);
const ref=`vault:${tenant}:${adapter}:${alias}.${version}`;
const now=Date.parse("2026-10-12T12:00:00.000Z");
const rawKey=Buffer.alloc(48,0x31);
const bearer=Array(75).fill("t").join("");
const digest=createHash("sha256")
  .update(`savant-harness-v1\0${tenant}\0${adapter}\0${alias}`)
  .digest("hex");
const secretName="savant-harness-"+digest.slice(0,48);
const id=`https://savant-test.vault.azure.net/secrets/${secretName}/${version}`;
async function denied(code:string,op:()=>Promise<unknown>){
  await assert.rejects(op,e=>e instanceof HarnessAzureVaultError&&e.code===code);
}
type Options={
  payload?:Record<string,unknown>;status?:number;response?:string;
  hang?:boolean;invalidToken?:boolean;tokenOutage?:boolean;
  timeoutMs?:number;wrongVault?:boolean;
};
function fixture(options:Options={}){
  const calls:string[]=[];
  const resolver=createAzureKeyVaultHarnessResolver({
    vaultName:options.wrongVault?"local.internal":"savant-test",
    nowMs:()=>now,
    timeoutMs:options.timeoutMs??3000,
    accessToken:async()=>{
      calls.push("token");
      if(options.tokenOutage)throw Error("AZURE-SECRET-TOKEN-MUST-NOT-ESCAPE");
      return options.invalidToken?"short":bearer;
    },
    transport:async(url,init)=>{
      calls.push("vault");
      assert.equal(url,id+"?api-version=7.4");
      assert.equal(init.method,"GET");
      assert.equal(init.redirect,"error");
      assert.equal(init.cache,"no-store");
      const headers=new Headers(init.headers);
      assert.equal(headers.get("authorization"),"Bearer "+bearer);
      assert.equal(headers.get("accept"),"application/json");
      assert.ok(init.signal instanceof AbortSignal);
      if(options.hang)return new Promise<Response>(()=>{});
      const body=options.payload??{
        id,value:rawKey.toString("base64url"),
        contentType:"application/vnd.savant.harness-hmac.base64url",
        attributes:{enabled:true,
          nbf:Math.floor(now/1000)-100,
          exp:Math.floor(now/1000)+3600},
      };
      return new Response(options.response??JSON.stringify(body),{
        status:options.status??200,headers:{"content-type":"application/json"},
      });
    },
  });
  return {resolver,calls};
}
test("PER-1059 Azure KV: tenant-derived, version-pinned Key Vault GET returns live HMAC bytes",async()=>{
  const f=fixture();
  const value=await f.resolver.readSecret(tenant,adapter,ref);
  assert.deepEqual(Buffer.from(value!),rawKey);
  assert.deepEqual(f.calls,["token","vault"]);
  assert.equal(await f.resolver.attestSecret({tenantId:tenant,adapterId:adapter,secretRef:ref}),true);
  assert.deepEqual(f.calls,["token","vault","token","vault"]);
});
test("PER-1059 Azure KV: malformed, unpinned and cross-tenant vault refs denied BEFORE network",async()=>{
  for(const candidate of [
    "foreign-reference",
    `vault:${tenant}:${adapter}:harness-hmac`,
    `vault:${tenant}:${adapter}:harness-hmac.bad-version`,
    `vault:${tenant}:other-adapter:${alias}.${version}`,
    `vault:${tenant}:${adapter}:../../.${version}`,
    `vault:${tenant}:${adapter}:${alias}.${version.toUpperCase()}`,
  ]){
    const f=fixture();
    await assert.rejects(()=>f.resolver.readSecret(tenant,adapter,candidate),
      e=>e instanceof HarnessAzureVaultError);
    assert.deepEqual(f.calls,[]);
  }
  const f=fixture();
  await denied("invalid_scope",()=>f.resolver.readSecret("foreign-tenant",adapter,ref));
  assert.deepEqual(f.calls,[]);
});
test("PER-1059 Azure KV: invalid static vault hosts cannot be constructed",()=>{
  for(const name of ["LOCALHOST","127.0.0.1","evil--vault","test.vault.azure.net","a","bad/vault"]){
    assert.throws(()=>createAzureKeyVaultHarnessResolver({
      vaultName:name,nowMs:()=>now,
      accessToken:async()=>bearer,
      transport:async()=>new Response("{}",{status:200}),
    }),e=>e instanceof HarnessAzureVaultError);
  }
});
test("PER-1059 Azure KV: expired, disabled, not-yet-valid and wrong-version responses fail closed",async()=>{
  const base={
    id,value:rawKey.toString("base64url"),
    contentType:"application/vnd.savant.harness-hmac.base64url",
    attributes:{enabled:true,nbf:Math.floor(now/1000)-1,exp:Math.floor(now/1000)+3600},
  };
  for(const altered of [
    {...base,id:id.replace(version,"e".repeat(32))},
    {...base,attributes:{...base.attributes,enabled:false}},
    {...base,attributes:{...base.attributes,nbf:Math.floor(now/1000)+3600}},
    {...base,attributes:{...base.attributes,exp:Math.floor(now/1000)-1}},
    {...base,contentType:"text/plain"},
    {...base,value:Buffer.alloc(16,0x55).toString("base64url")},
    {...base,value:Buffer.alloc(129,0x55).toString("base64url")},
    {...base,value:"invalid+base64/encoding="},
  ]){
    const f=fixture({payload:altered});
    await assert.rejects(()=>f.resolver.readSecret(tenant,adapter,ref),
      e=>e instanceof HarnessAzureVaultError&&
        !JSON.stringify(e).includes(rawKey.toString("base64url")));
    assert.deepEqual(f.calls,["token","vault"]);
  }
});
test("PER-1059 Azure KV: unexpected HTTP, malformed JSON and oversized streamed content fail closed",async()=>{
  for(const opts of [
    {status:403},
    {status:503},
    {response:"invalid-json"},
    {response:"z".repeat(5000)},
  ]){
    const f=fixture(opts);
    await denied("vault_unavailable",()=>f.resolver.readSecret(tenant,adapter,ref));
    assert.deepEqual(f.calls,["token","vault"]);
  }
});
test("PER-1059 Azure KV: inaccessible workload identity never contacts vault",async()=>{
  for(const opts of [{tokenOutage:true},{invalidToken:true}]){
    const f=fixture(opts);
    await denied("credential_unavailable",()=>f.resolver.readSecret(tenant,adapter,ref));
    assert.deepEqual(f.calls,["token"]);
  }
});
test("PER-1059 Azure KV: hung remote transport is bounded even if AbortSignal ignored",async()=>{
  const f=fixture({hang:true,timeoutMs:100});
  const start=Date.now();
  await denied("vault_unavailable",()=>f.resolver.readSecret(tenant,adapter,ref));
  assert.ok(Date.now()-start<1000);
  assert.deepEqual(f.calls,["token","vault"]);
});

test("PER-1059 Azure KV: stalled workload identity acquisition obeys one deadline without contacting vault",async()=>{
  let remoteCalls=0,identityCalls=0;
  const reader=createAzureKeyVaultHarnessResolver({
    vaultName:"savant-test",timeoutMs:100,nowMs:()=>now,
    accessToken:async()=>{identityCalls++;return new Promise<string>(()=>{});},
    transport:async()=>{remoteCalls++;throw Error("must not contact vault");},
  });
  const started=Date.now();
  await denied("credential_unavailable",()=>reader.readSecret(tenant,adapter,ref));
  assert.ok(Date.now()-started<1000,"hung managed identity must have a bounded deadline");
  assert.equal(identityCalls,1);assert.equal(remoteCalls,0);
});
test("PER-1059 Azure KV: rejected status cancels the response stream and aborts the request",async()=>{
  let wasCanceled=false,wasAborted=false;
  const reader=createAzureKeyVaultHarnessResolver({
    vaultName:"savant-test",timeoutMs:300,nowMs:()=>now,
    accessToken:async()=>bearer,
    transport:async(_url,init)=>{
      const signal=init.signal as AbortSignal;
      signal.addEventListener("abort",()=>{wasAborted=true;},{once:true});
      return new Response(new ReadableStream<Uint8Array>({
        // Deliberately never complete or yield a body.
        start(){},
        cancel(){wasCanceled=true;},
      }),{status:403,headers:{"content-type":"text/plain"}});
    },
  });
  await denied("vault_unavailable",()=>reader.readSecret(tenant,adapter,ref));
  assert.equal(wasCanceled,true,"rejecting a vault response must cancel its body");
  assert.equal(wasAborted,true,"rejecting a vault response must terminate network IO");
});
