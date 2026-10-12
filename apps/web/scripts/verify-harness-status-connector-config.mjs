import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createHarnessStatusConnectorConfigStore,HarnessConnectorConfigError}
  from "../src/server/harness/status-connector-config.ts";
import {createSignedHarnessStatusLookup}
  from "../src/server/harness/signed-status-connector.ts";

const url=process.env.DATABASE_URL;
if(!url||process.env.SAVANT_HARNESS_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(url).hostname))
  throw Error("Isolated local PostgreSQL with SAVANT_HARNESS_SCHEMA_TEST=1 required");
const sql=postgres(url,{max:6,prepare:false});
const stamp=randomUUID().slice(0,8);
const adapterId="sandbox-adapter",endpoint="https://customer-status.example.com/v1/savant/status";
let tenant=null,foreign=null,allowAdmin=true,allowVault=true,allowEgress=true;
let concurrentChange=false,attestationCalls=0,egressCalls=0;
const denied=async(code,fn)=>assert.rejects(fn,e=>
  e instanceof HarnessConnectorConfigError&&e.code===code);
try{
  const [a]=await sql`insert into organizations(slug,display_name)
    values(${"config-a-"+stamp},'Status config A') returning id`;
  const [b]=await sql`insert into organizations(slug,display_name)
    values(${"config-b-"+stamp},'Status config B') returning id`;
  tenant=a.id;foreign=b.id;
  const ref=(key="key-1")=>`vault:${tenant}:${adapterId}:${key}`;
  const store=createHarnessStatusConnectorConfigStore({
    sql,now:()=>new Date("2026-10-12T12:00:00Z"),
    allowedOrigins:["https://customer-status.example.com"],
    authorizeAdmin:async scope=>allowAdmin&&scope.tenantId===tenant&&
      scope.adapterId===adapterId&&scope.actor==="security-admin",
    attestSecret:async scope=>{
      attestationCalls++;
      if(concurrentChange){
        concurrentChange=false;
        // Deliberately modify the DB between preflight attestation and CAS.
        await sql`update harness_status_connector_configs
          set revision=revision+1,updated_by='competing-admin'
          where organization_id=${tenant} and adapter_id=${adapterId}`;
      }
      return allowVault&&scope.tenantId===tenant&&scope.adapterId===adapterId&&
        scope.secretRef.startsWith(`vault:${tenant}:${adapterId}:`);
    },
    verifyEgress:async(t,e)=>{egressCalls++;return allowEgress&&t===tenant&&e===endpoint;},
  });
  const input={tenantId:tenant,adapterId,actor:"security-admin",endpoint,secretRef:ref("key-1")};
  await denied("unauthorized",()=>store.save({...input,tenantId:foreign,expectedRevision:null}));
  await denied("unauthorized",()=>store.save({...input,actor:"untrusted",expectedRevision:null}));
  assert.equal((await sql`select count(*)::int as n from harness_status_connector_configs`)[0].n,0);

  let meta=await store.save({...input,expectedRevision:null});
  assert.deepEqual(meta,{tenantId:tenant,adapterId,endpoint,status:"disabled",revision:1});
  assert.equal(JSON.stringify(meta).includes("secretRef"),false,
    "public config response must never expose vault refs");
  assert.equal(await store.resolveActive(tenant,adapterId),null);
  await denied("version_conflict",()=>store.save({...input,expectedRevision:null}));
  await denied("version_conflict",()=>store.activate({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:2,
  }));
  allowEgress=false;
  await denied("egress_unavailable",()=>store.activate({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:1,
  }));
  allowEgress=true;
  allowVault=false;
  await denied("credential_unavailable",()=>store.activate({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:1,
  }));
  allowVault=true;
  concurrentChange=true;
  await denied("version_conflict",()=>store.activate({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:1,
  }));
  assert.equal((await sql`select status,revision from harness_status_connector_configs
    where organization_id=${tenant}`)[0].revision,2);
  meta=await store.activate({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:2,
  });
  assert.equal(meta.status,"active");assert.equal(meta.revision,3);
  assert.deepEqual(await store.resolveActive(tenant,adapterId),{
    endpoint,secretRef:ref("key-1"),
  });
  // Binding can now be injected directly into the signed lookup (no browser URL).
  const boundLookup=createSignedHarnessStatusLookup({
    allowedOrigins:["https://customer-status.example.com"],
    resolveConnection:(t,a)=>store.resolveActive(t,a),
    readSecret:async()=>Buffer.alloc(32,0x45),
    nowMs:()=>Date.parse("2026-10-12T12:00:00Z"),
    transport:async()=>{throw Error("no live provider in this increment");},
  });
  assert.equal(typeof boundLookup,"function");
  allowEgress=false;
  await denied("egress_unavailable",()=>store.resolveActive(tenant,adapterId));
  allowEgress=true;
  assert.equal(await store.resolveActive(foreign,adapterId),null);

  meta=await store.save({...input,secretRef:ref("key-2"),expectedRevision:3});
  assert.equal(meta.status,"disabled");
  assert.equal(meta.revision,4);
  assert.equal(await store.resolveActive(tenant,adapterId),null);
  const [first,second]=await Promise.allSettled([
    store.save({...input,secretRef:ref("key-3"),expectedRevision:4}),
    store.save({...input,secretRef:ref("key-4"),expectedRevision:4}),
  ]);
  assert.deepEqual([first.status,second.status].sort(),["fulfilled","rejected"],
    "same revision admits only one concurrent admin mutation");
  await denied("version_conflict",()=>store.disable({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:4,
  }));
  const disabled=await store.disable({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:5,
  });
  assert.equal(disabled.revision,6);
  allowAdmin=false;
  await denied("unauthorized",()=>store.disable({
    tenantId:tenant,adapterId,actor:"security-admin",expectedRevision:6,
  }));
  allowAdmin=true;
  const persisted=await sql`select endpoint,secret_ref,status,revision
    from harness_status_connector_configs where organization_id=${tenant}`;
  assert.equal(persisted.length,1);
  assert.equal(persisted[0].status,"disabled");
  assert.equal(persisted[0].revision,6);
  assert.ok(persisted[0].secret_ref.startsWith(`vault:${tenant}:${adapterId}:`));
  assert.ok(attestationCalls>=6&&egressCalls>=3);

  // SQL constraint also denies tenant-crossing credential references.
  let crossTenantDenied=false;
  try{
    await sql`insert into harness_status_connector_configs
      (organization_id,adapter_id,endpoint,secret_ref,updated_by)
      values (${foreign},${adapterId},${endpoint},${ref("key-2")},'attacker')`;
  }catch(e){crossTenantDenied=e.code==="23514";if(!crossTenantDenied)throw e;}
  assert.equal(crossTenantDenied,true);
  await sql`delete from organizations where id=${tenant}`;tenant=null;
  assert.equal((await sql`select count(*)::int as n from harness_status_connector_configs`)[0].n,0);
  console.log(JSON.stringify({harnessStatusConnectorConfig:"passed",
    checks:["tenant scoped administration","disabled by default","vault reference only",
      "network policy activation gate","vault revocation deny","CAS concurrency",
      "external attest outside SQL transaction","runtime policy recheck",
      "cross-tenant DB constraint","FK cascade"]}));
}finally{
  if(tenant)await sql`delete from organizations where id=${tenant}`;
  if(foreign)await sql`delete from organizations where id=${foreign}`;
  await sql.end({timeout:5});
}
