import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import test from "node:test";
import {createSignedHarnessStatusLookup,HarnessStatusConnectorError} from "./signed-status-connector.ts";

const tenantId="11111111-1111-4111-8111-111111111111";
const adapterId="sandbox-adapter";
const scope={tenantId,adapterId,runId:"run-1",idempotencyKey:"idem-1",traceId:"trace-1"};
const origin="https://customer-harness.example.com";
const endpoint=origin+"/v1/savant/status";
const secret=Buffer.alloc(32,0x51);
const now=Date.parse("2026-10-12T12:00:00.000Z");
function sign(prefix:string,stamp:string,nonce:string,bytes:Uint8Array){
  return "v1="+createHmac("sha256",secret)
    .update(Buffer.concat([
      Buffer.from(`${prefix}\n${stamp}\n${nonce}\n${tenantId}\n${adapterId}\nrun-1\n`),Buffer.from(bytes),
    ])).digest("hex");
}
type FixtureOptions={
  endpoint?:string;allowedOrigins?:string[];secret?:Uint8Array|null;
  state?:"accepted"|"not_found"|"unknown";tamper?:boolean;extra?:boolean;
  wrongTenant?:boolean;wrongNonce?:boolean;status?:number;
  hang?:boolean;error?:boolean;raw?:string;timeoutMs?:number;
};
function fixture(options:FixtureOptions={}){
  const calls:string[]=[];
  let sent="";
  const lookup=createSignedHarnessStatusLookup({
    allowedOrigins:options.allowedOrigins??[origin],
    nowMs:()=>now,timeoutMs:options.timeoutMs??3000,
    resolveConnection:async(t,a)=>{
      calls.push("resolve");
      assert.equal(t,tenantId);assert.equal(a,adapterId);
      return {endpoint:options.endpoint??endpoint,
        secretRef:`vault:${tenantId}:${adapterId}:current`};
    },
    readSecret:async(t,a,ref)=>{
      calls.push("vault");
      assert.equal(ref,`vault:${tenantId}:${adapterId}:current`);
      assert.equal(t,tenantId);assert.equal(a,adapterId);
      return options.secret===undefined?secret:options.secret;
    },
    transport:async(url,init)=>{
      calls.push("transport");
      assert.equal(url,endpoint);
      assert.equal(init.method,"POST");
      assert.equal(init.redirect,"error");
      const headers=new Headers(init.headers);
      const stamp=headers.get("x-savant-timestamp")!;
      const nonce=headers.get("x-savant-nonce")!;
      assert.match(nonce,/^[a-f0-9]{32}$/);
      const body=Buffer.from(init.body as Uint8Array);
      sent=body.toString("utf8");
      assert.equal(headers.get("x-savant-signature"),
        sign("savant-harness-status-request-v1",stamp,nonce,body));
      assert.deepEqual(JSON.parse(sent),scope);
      if(options.error)throw Error("PROVIDER_SECRET_DO_NOT_ECHO");
      if(options.hang)return new Promise<Response>(()=>{});
      const response=options.raw??JSON.stringify({
        tenantId:options.wrongTenant?"22222222-2222-4222-8222-222222222222":tenantId,
        adapterId,runId:"run-1",idempotencyKey:"idem-1",
        providerState:options.state??"accepted",
        ...(options.extra?{prompt:"RAW_SECRET"}:{}),
      });
      const bytes=Buffer.from(response);
      const responseHeaders={
        "content-type":"application/json",
        "x-savant-timestamp":stamp,
        "x-savant-nonce":options.wrongNonce?"a".repeat(32):nonce,
        "x-savant-signature":options.tamper?"v1="+"0".repeat(64):
          sign("savant-harness-status-response-v1",stamp,nonce,bytes),
      };
      return new Response(new Uint8Array(bytes),{
        status:options.status??200,headers:responseHeaders,
      });
    },
  });
  return {lookup,calls,sent:()=>sent};
}
async function denied(code:string,fn:()=>Promise<unknown>){
  await assert.rejects(fn,(e:unknown)=>
    e instanceof HarnessStatusConnectorError&&e.code===code);
}
test("PER-1059: signed status uses immutable original key and accepts authenticated minimal evidence",async()=>{
  const f=fixture();
  const out=await f.lookup(scope);
  assert.deepEqual(f.calls,["resolve","vault","transport"]);
  assert.equal(out.providerState,"accepted");
  assert.equal(out.tenantId,tenantId);
  assert.equal(out.idempotencyKey,"idem-1");
  assert.match(out.evidenceSha256,/^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(out).includes("RAW_SECRET"));
});
test("PER-1059: provider not_found remains only metadata evidence, not permission to retry",async()=>{
  const f=fixture({state:"not_found"});
  const result=await f.lookup(scope);
  assert.equal(result.providerState,"not_found");
  assert.equal(Object.hasOwn(result,"retryAuthorized"),false);
});
test("PER-1059: invalid scope and tenant-request injection denied before network or vault",async()=>{
  for(const change of [
    {tenantId:"bad"},{runId:"../../other"},{adapterId:"http://evil"},
    {traceId:"bad\nid"},{idempotencyKey:"bad?search"},
  ]){
    const f=fixture();
    await denied("invalid_scope",()=>f.lookup({...scope,...change}));
    assert.deepEqual(f.calls,[]);
  }
});
test("PER-1059: SSRF URLs and unapproved HTTPS origins rejected before secret access",async()=>{
  for(const url of [
    "http://customer-harness.example.com/v1/savant/status",
    "https://127.0.0.1/v1/savant/status",
    "https://localhost/v1/savant/status",
    "https://10.0.0.1/v1/savant/status",
    "https://customer-harness.example.com:8443/v1/savant/status",
    "https://user:pass@customer-harness.example.com/v1/savant/status",
    "https://customer-harness.example.com/v1/savant/status?q=secret",
    "https://customer-harness.example.com/redirect",
    "https://unapproved.example.com/v1/savant/status",
  ]){
    const f=fixture({endpoint:url});
    await denied("invalid_connection",()=>f.lookup(scope));
    assert.deepEqual(f.calls,["resolve"]);
  }
});
test("PER-1059: absent, short or oversized vault keys block provider I/O",async()=>{
  for(const key of [null,new Uint8Array(0),new Uint8Array(31),new Uint8Array(129)]){
    const f=fixture({secret:key});
    await denied("credential_unavailable",()=>f.lookup(scope));
    assert.deepEqual(f.calls,["resolve","vault"]);
  }
});
test("PER-1059: forged signed reply, altered nonce, wrong tenant, raw content or non-200 is rejected",async()=>{
  for(const options of [
    {tamper:true},{wrongNonce:true},{wrongTenant:true},{extra:true},
    {status:503},{raw:"not-json"},{raw:"x".repeat(5000)},
  ]){
    const f=fixture(options);
    await denied("transport_or_verification_failed",()=>f.lookup(scope));
    assert.deepEqual(f.calls,["resolve","vault","transport"]);
  }
});
test("PER-1059: provider errors and non-cooperative HTTP requests are timeout-bounded and redacted",async()=>{
  const fail=fixture({error:true});
  await denied("transport_or_verification_failed",()=>fail.lookup(scope));
  const hung=fixture({hang:true,timeoutMs:100});
  const started=Date.now();
  await denied("transport_or_verification_failed",()=>hung.lookup(scope));
  assert.ok(Date.now()-started<1000);
});

test("PER-1059: mutable caller cannot switch tenant or idempotency after async connector lookup",async()=>{
  const mutable={...scope};
  let vaultScopeCorrect=false;
  const lookup=createSignedHarnessStatusLookup({
    allowedOrigins:[origin],nowMs:()=>now,
    resolveConnection:async()=>{
      mutable.tenantId="22222222-2222-4222-8222-222222222222";
      mutable.idempotencyKey="forged-key";
      return {endpoint,secretRef:`vault:${tenantId}:${adapterId}:current`};
    },
    readSecret:async(t,a)=>{
      vaultScopeCorrect=t===tenantId&&a===adapterId;
      return secret;
    },
    transport:async(_,init)=>{
      const body=JSON.parse(Buffer.from(init.body as Uint8Array).toString("utf8"));
      assert.equal(body.tenantId,tenantId);
      assert.equal(body.idempotencyKey,"idem-1");
      const hdr=new Headers(init.headers);
      const stamp=hdr.get("x-savant-timestamp")!,nonce=hdr.get("x-savant-nonce")!;
      const raw=Buffer.from(JSON.stringify({
        tenantId,adapterId,runId:"run-1",idempotencyKey:"idem-1",providerState:"unknown",
      }));
      return new Response(new Uint8Array(raw),{
        status:200,headers:{"content-type":"application/json",
          "x-savant-timestamp":stamp,"x-savant-nonce":nonce,
          "x-savant-signature":sign("savant-harness-status-response-v1",stamp,nonce,raw)},
      });
    },
  });
  assert.equal((await lookup(mutable)).providerState,"unknown");
  assert.equal(vaultScopeCorrect,true);
});
test("PER-1059: hostile scope getters never cause vault or provider IO",async()=>{
  const hostile={...scope};
  Object.defineProperty(hostile,"tenantId",{enumerable:true,
    get(){throw Error("RAW_CREDENTIAL_FROM_GETTER");}});
  const f=fixture();
  await denied("invalid_scope",()=>f.lookup(hostile));
  assert.deepEqual(f.calls,[]);
});

test("PER-1059: slow vault resolution timestamps after await to avoid expired HMAC",async()=>{
  let phase=0;
  let clockReads=0;
  const lookup=createSignedHarnessStatusLookup({
    allowedOrigins:[origin],
    nowMs:()=>{clockReads++;return now+phase*3600000;},
    resolveConnection:async()=>{phase=1;return {
      endpoint,secretRef:`vault:${tenantId}:${adapterId}:current`};
    },
    readSecret:async()=>{phase=2;return secret;},
    transport:async(_url,init)=>{
      const hdr=new Headers(init.headers);
      const sent=Number(hdr.get("x-savant-timestamp"));
      assert.equal(sent,Math.floor((now+7200000)/1000),
        "HMAC timestamp must be sampled after slow config and vault awaits");
      const nonce=hdr.get("x-savant-nonce")!;
      const stamp=String(sent);
      const raw=Buffer.from(JSON.stringify({
        tenantId,adapterId,runId:"run-1",idempotencyKey:"idem-1",providerState:"unknown",
      }));
      return new Response(new Uint8Array(raw),{
        status:200,headers:{"content-type":"application/json",
          "x-savant-timestamp":stamp,"x-savant-nonce":nonce,
          "x-savant-signature":sign("savant-harness-status-response-v1",stamp,nonce,raw)},
      });
    },
  });
  assert.equal((await lookup(scope)).providerState,"unknown");
  assert.equal(clockReads,1);
});
