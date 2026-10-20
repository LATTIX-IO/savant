import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import postgres from "postgres";
import {createHarnessSigningKeyRegistry,HarnessSigningKeyError}
  from "../src/server/harness/signing-key-registry.ts";
import {createSignedHarnessEventAdmission,SignedHarnessEventError}
  from "../src/server/harness/signed-event-admission.ts";

const url=process.env.DATABASE_URL;
if(!url||process.env.SAVANT_HARNESS_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(url).hostname))
  throw Error("Isolated local PostgreSQL and SAVANT_HARNESS_SCHEMA_TEST=1 are required.");
const sql=postgres(url,{max:8,prepare:false});
const now={at:new Date("2026-10-12T12:00:00.000Z")};
const stamp=randomUUID().slice(0,8);
const keys=new Map();
let a=null,b=null;
function ref(tenant,version){return `vault:${tenant}:adapter-a:key-${version}`;}
const key1=Buffer.alloc(32,0x11),key2=Buffer.alloc(32,0x22),key3=Buffer.alloc(32,0x33);
const expiry=()=>new Date(now.at.getTime()+30*86400000);
const start=()=>new Date(now.at.getTime()-3600000);
const isDenied=async(code,fn,ErrorType=HarnessSigningKeyError)=>
  assert.rejects(fn,e=>e instanceof ErrorType&&e.code===code);
try{
  const [one]=await sql`
    insert into organizations(slug,display_name)
    values(${"sign-a-"+stamp},'Signing test A') returning id
  `;
  const [two]=await sql`
    insert into organizations(slug,display_name)
    values(${"sign-b-"+stamp},'Signing test B') returning id
  `;
  a=one.id;b=two.id;
  for(const [version,key] of [[1,key1],[2,key2],[3,key3]])keys.set(ref(a,version),key);
  let adminChecks=0, vaultReads=0;
  const registry=createHarnessSigningKeyRegistry({
    sql,now:()=>now.at,
    authorizeAdmin:async(tenant,actor)=>{
      adminChecks++;
      return tenant===a&&actor==="verified-security-admin";
    },
    readSecret:async(tenant,adapter,reference)=>{
      vaultReads++;
      if(tenant!==a||adapter!=="adapter-a")throw Error("bad scope");
      return keys.get(reference)??null;
    },
  });
  const activate=(version,graceMs=5000)=>registry.activate({
    tenantId:a,adapterId:"adapter-a",actor:"verified-security-admin",
    secretRef:ref(a,version),version,notBefore:start(),expiresAt:expiry(),graceMs,
  });
  await isDenied("unauthorized",()=>registry.activate({
    tenantId:a,adapterId:"adapter-a",actor:"untrusted",
    secretRef:ref(a,1),version:1,notBefore:start(),expiresAt:expiry(),
  }));
  assert.equal((await sql`select count(*)::int as n from harness_adapter_signing_keys`)[0].n,0);
  await isDenied("invalid_ref",()=>registry.activate({
    tenantId:a,adapterId:"adapter-a",actor:"verified-security-admin",
    secretRef:ref(b,1),version:1,notBefore:start(),expiresAt:expiry(),
  }));
  const first=await activate(1);
  assert.equal(first.status,"active");
  assert.equal(first.version,1);
  assert.deepEqual((await registry.resolveSecrets(a,"adapter-a")).map(x=>Buffer.from(x).toString("hex")),
    [key1.toString("hex")]);
  await isDenied("version_conflict",()=>activate(1));

  const makeSigner=(key,deliveryId="delivery-1")=>{
    const timestamp=String(Math.floor(now.at.getTime()/1000));
    const event={eventId:"evt-1",tenantId:a,runId:"run-1",traceId:"trace-1",sequence:1,status:"running"};
    const rawBody=Buffer.from(JSON.stringify(event));
    const prefix=Buffer.from(`savant-harness-v1\n${timestamp}\n${a}\nadapter-a\nrun-1\n${deliveryId}\n`);
    return {
      tenantId:a,adapterId:"adapter-a",runId:"run-1",deliveryId,
      timestamp,rawBody,
      signature:"v1="+createHmac("sha256",key).update(Buffer.concat([prefix,rawBody])).digest("hex"),
    };
  };
  let delivered=0;
  const admission=createSignedHarnessEventAdmission({
    nowMs:()=>now.at.getTime(),
    resolveSecrets:(tenant,adapter)=>registry.resolveSecrets(tenant,adapter),
    getRun:async(tenant,runId)=>({tenantId:tenant,adapterId:"adapter-a",
      runId,traceId:"trace-1",status:"running"}),
    applyEvent:async()=>{delivered++;return {accepted:true};},
  });
  assert.deepEqual(await admission(makeSigner(key1)),{accepted:true});
  await activate(2);
  let scoped=await registry.resolveSecrets(a,"adapter-a");
  assert.equal(scoped.length,2);
  assert.equal(Buffer.from(scoped[0]).toString("hex"),key2.toString("hex"));
  assert.equal(Buffer.from(scoped[1]).toString("hex"),key1.toString("hex"));
  assert.deepEqual(await admission(makeSigner(key1,"delivery-old")), {accepted:true});
  assert.deepEqual(await admission(makeSigner(key2,"delivery-new")), {accepted:true});
  await isDenied("no_active_key",()=>registry.resolveSecrets(b,"adapter-a"));
  await isDenied("invalid_scope",()=>registry.resolveSecrets(a,"bad/adapter"));
  now.at=new Date(now.at.getTime()+6000);
  assert.equal((await registry.resolveSecrets(a,"adapter-a")).length,1);
  await isDenied("unauthorized",()=>admission(makeSigner(key1,"delivery-expired")),SignedHarnessEventError);
  await activate(3,0);
  assert.equal((await registry.resolveSecrets(a,"adapter-a")).length,1);
  await isDenied("unauthorized",()=>admission(makeSigner(key2,"delivery-revoked")),SignedHarnessEventError);
  assert.deepEqual(await admission(makeSigner(key3,"delivery-third")),{accepted:true});
  assert.equal((await registry.revoke({
    tenantId:a,adapterId:"adapter-a",actor:"verified-security-admin",version:3,
  })).status,"revoked");
  await isDenied("no_active_key",()=>registry.resolveSecrets(a,"adapter-a"));
  await isDenied("unauthorized",()=>admission(makeSigner(key3,"delivery-disabled")),SignedHarnessEventError);
  assert.equal(delivered,4);
  assert.ok(adminChecks>=5);
  assert.ok(vaultReads>=5);
  const rows=await sql`
    select key_version,status,secret_ref from harness_adapter_signing_keys
    where organization_id=${a} order by key_version
  `;
  assert.deepEqual(rows.map(x=>x.status),["revoked","revoked","revoked"]);
  assert.ok(rows.every(x=>x.secret_ref.startsWith("vault:"+a+":adapter-a:")));
  assert.equal((await sql`
    select count(*)::int as n from harness_adapter_signing_keys where organization_id=${b}
  `)[0].n,0);
  await sql`delete from organizations where id=${a}`;a=null;
  assert.equal((await sql`select count(*)::int as n from harness_adapter_signing_keys`)[0].n,0);
  console.log(JSON.stringify({signingKeyRegistry:"passed",
    checks:["admin authorization","vault namespaces","versions","rotation grace",
      "secret expiry and revocation","signed event HMAC interoperability",
      "tenant isolation","DB cascade","no raw key persisted"]}));
}finally{
  if(a)await sql`delete from organizations where id=${a}`;
  if(b)await sql`delete from organizations where id=${b}`;
  await sql.end({timeout:5});
}
