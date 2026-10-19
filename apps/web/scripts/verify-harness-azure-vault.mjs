import assert from "node:assert/strict";
import {createHmac,randomUUID} from "node:crypto";
import postgres from "postgres";
import {mkdtemp,mkdir,writeFile,symlink,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createAksProjectedAssertionReader}
  from "../src/server/harness/aks-projected-assertion.ts";
import {createAzureKeyVaultHarnessResolver}
  from "../src/server/harness/azure-vault-hmac.ts";
import {createAzureFederatedWorkloadTokenProvider}
  from "../src/server/harness/azure-federated-token.ts";
import {createHarnessStatusConnectorConfigStore}
  from "../src/server/harness/status-connector-config.ts";
import {createSignedHarnessStatusLookup}
  from "../src/server/harness/signed-status-connector.ts";
import {createHarnessReservationStore} from "../src/server/harness/invocation-reservations.ts";
import {createHarnessDispatchLeaseQueue} from "../src/server/harness/dispatch-leases.ts";
import {createHarnessProviderReconciliation}
  from "../src/server/harness/provider-reconciliation.ts";

const url=process.env.DATABASE_URL;
if(!url||process.env.SAVANT_HARNESS_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(url).hostname))
  throw Error("Isolated PostgreSQL with explicit opt-in is required");
const sql=postgres(url,{max:8,prepare:false});
const now=Date.parse("2026-10-12T12:00:00Z");
const id=randomUUID().slice(0,8);
const version="d".repeat(32);
const adapterId="sandbox-adapter",runId="run-vault";
const providerOrigin="https://tenant-harness.example.com";
const endpoint=providerOrigin+"/v1/savant/status";
const key=Buffer.alloc(48,0x2b);
const token=Array(80).fill("t").join("");
let tenant=null,foreign=null,enabled=true,projectionRoot=null;
const configs=[];
const vaultRequests=[];
try{
  const [a]=await sql`insert into organizations(slug,display_name)
    values(${"azure-a-"+id},'Azure Vault A') returning id`;
  const [b]=await sql`insert into organizations(slug,display_name)
    values(${"azure-b-"+id},'Azure Vault B') returning id`;
  tenant=a.id;foreign=b.id;
  const ref=`vault:${tenant}:${adapterId}:status-key.${version}`;
  const identityTenant="33333333-3333-4333-8333-333333333333";
  const identityClient="44444444-4444-4444-8444-444444444444";
  const serviceIssuer="https://issuer.example.com/aks/savant/";
  const serviceSubject="system:serviceaccount:savant:harness-status";
  const claim={iss:serviceIssuer,sub:serviceSubject,aud:["api://AzureADTokenExchange"],
    iat:Math.floor(now/1000)-60,nbf:Math.floor(now/1000)-60,
    exp:Math.floor(now/1000)+3600};
  const assertion=[{alg:"RS256",typ:"JWT"},claim,{test:"signature"}]
    .map(v=>Buffer.from(JSON.stringify(v)).toString("base64url")).join(".");
  projectionRoot=await mkdtemp(join(tmpdir(),"savant-aks-uat-"));
  const release=join(projectionRoot,"..release-1");
  await mkdir(release);
  await writeFile(join(release,"assertion"),assertion);
  await symlink("..release-1",join(projectionRoot,"..data"));
  const tokenFilePath=join(projectionRoot,"azure-identity-token");
  await symlink("..data/assertion",tokenFilePath);
  const projectedReader=createAksProjectedAssertionReader({
    tokenFilePath,trustedMountRoot:projectionRoot,
    expectedIssuer:serviceIssuer,expectedSubject:serviceSubject,nowMs:()=>now,
  });
  let federationCalls=0;
  const federatedToken=createAzureFederatedWorkloadTokenProvider({
    tenantId:identityTenant,clientId:identityClient,
    readFederatedAssertion:projectedReader,
    transport:async(tokenUrl,init)=>{
      federationCalls++;
      assert.equal(tokenUrl,"https://login.microsoftonline.com/"+identityTenant+"/oauth2/v2.0/token");
      assert.equal(init.method,"POST");assert.equal(init.redirect,"error");
      const form=new URLSearchParams(init.body);
      assert.equal(form.get("scope"),"https://vault.azure.net/.default");
      assert.equal(form.get("client_assertion"),assertion);
      assert.equal(form.get("client_id"),identityClient);
      return new Response(JSON.stringify({token_type:"Bearer",access_token:token,expires_in:3600}),
        {status:200,headers:{"content-type":"application/json"}});
    },
  });
  const azure=createAzureKeyVaultHarnessResolver({
    vaultName:"savant-test",
    accessToken:federatedToken,
    nowMs:()=>now,
    transport:async (vaultUrl,request)=>{
      vaultRequests.push(vaultUrl);
      assert.equal(new URL(vaultUrl).hostname,"savant-test.vault.azure.net");
      assert.equal(new URL(vaultUrl).searchParams.get("api-version"),"7.4");
      assert.equal(request.method,"GET");assert.equal(request.redirect,"error");
      assert.equal(new Headers(request.headers).get("authorization"),"Bearer "+token);
      const exactId=vaultUrl.split("?")[0];
      return new Response(JSON.stringify({
        id:exactId,value:key.toString("base64url"),
        contentType:"application/vnd.savant.harness-hmac.base64url",
        attributes:{enabled,exp:Math.floor(now/1000)+3600},
      }),{status:200,headers:{"content-type":"application/json"}});
    },
  });
  const store=createHarnessStatusConnectorConfigStore({
    sql,now:()=>new Date(now),
    allowedOrigins:[providerOrigin],
    authorizeAdmin:async x=>x.tenantId===tenant&&x.adapterId===adapterId&&x.actor==="verified-admin",
    attestSecret:input=>azure.attestSecret(input),
    verifyEgress:async(t,origin)=>t===tenant&&origin===endpoint,
  });
  const config={tenantId:tenant,adapterId,actor:"verified-admin",
    endpoint,secretRef:ref};
  const saved=await store.save({...config,expectedRevision:null});
  assert.equal(saved.status,"disabled");
  assert.equal(await store.resolveActive(tenant,adapterId),null);
  const active=await store.activate({tenantId:tenant,adapterId,actor:"verified-admin",expectedRevision:1});
  assert.equal(active.status,"active");
  configs.push(active);
  assert.deepEqual(await store.resolveActive(tenant,adapterId),{endpoint,secretRef:ref});
  assert.equal(await store.resolveActive(foreign,adapterId),null);

  const caps={protocol:{major:1,minor:0},adapterId,
    features:{execute:true,observe:true,cancel:true,events:true},
    coverage:{execution:"partial",observation:"partial"},
    limits:{maxConcurrency:2,maxDurationMs:30000,maxCostUsd:1}};
  const request={tenantId:tenant,adapterId,actor:"verified-admin",runId,
    traceId:"trace-vault",idempotencyKey:"idem-vault",
    specVersionHash:"a".repeat(64),testSuiteHash:"b".repeat(64),
    inputRef:"fixture-safe",budget:{maxDurationMs:10000,maxCostUsd:0.25},
    capture:{level:"metadata",retentionDays:7,residency:"us-east-1"}};
  const reservations=createHarnessReservationStore({
    sql,now:()=>new Date(now),limits:{maxActive:2,maxReservedCostUsd:1},
  });
  await reservations.reserve({organizationId:tenant,actorSubject:"verified-admin",
    request,capabilities:caps});
  const worker={tenantId:tenant,adapterId,workerId:"trusted-worker"};
  const queue=createHarnessDispatchLeaseQueue({sql,now:()=>new Date(now),
    authorizeWorker:async x=>x.tenantId===tenant&&x.workerId==="trusted-worker"});
  const lease=await queue.claim(worker,500);
  await queue.markDispatchStarted(worker,runId,lease.leaseToken);
  let actualStatusRequests=0;
  const signed=createSignedHarnessStatusLookup({
    allowedOrigins:[providerOrigin],
    resolveConnection:(t,a)=>store.resolveActive(t,a),
    readSecret:(t,a,r)=>azure.readSecret(t,a,r),
    nowMs:()=>now,
    transport:async (statusUrl,init)=>{
      actualStatusRequests++;
      assert.equal(statusUrl,endpoint);
      assert.equal(init.redirect,"error");
      const hdr=new Headers(init.headers),stamp=hdr.get("x-savant-timestamp");
      const nonce=hdr.get("x-savant-nonce");
      const frame=prefix=>Buffer.from(`${prefix}\n${stamp}\n${nonce}\n${tenant}\n${adapterId}\n${runId}\n`);
      const outgoing=Buffer.from(init.body);
      assert.equal(hdr.get("x-savant-signature"),"v1="+createHmac("sha256",key)
        .update(Buffer.concat([frame("savant-harness-status-request-v1"),outgoing]))
        .digest("hex"));
      assert.equal(JSON.parse(outgoing).idempotencyKey,"idem-vault");
      const content=Buffer.from(JSON.stringify({
        tenantId:tenant,adapterId,runId,idempotencyKey:"idem-vault",
        providerState:"accepted",
      }));
      const responseMac="v1="+createHmac("sha256",key)
        .update(Buffer.concat([frame("savant-harness-status-response-v1"),content]))
        .digest("hex");
      return new Response(new Uint8Array(content),{status:200,
        headers:{"content-type":"application/json","x-savant-timestamp":stamp,
          "x-savant-nonce":nonce,"x-savant-signature":responseMac}});
    },
  });
  const reconcile=createHarnessProviderReconciliation({
    sql,now:()=>new Date(now),
    authorizeOperator:async who=>who.tenantId===tenant&&who.actor==="security-operator",
    verifiedLookup:signed,
  });
  const args={tenantId:tenant,adapterId,runId,actor:"security-operator",observationId:"azure-1"};
  assert.equal((await reconcile.inspectAndRecord(args)).state,"accepted");
  assert.equal(actualStatusRequests,1);
  assert.equal((await sql`select count(*)::int as n from
    harness_eval_reconciliation_observations where organization_id=${tenant}`)[0].n,1);
  assert.equal((await reservations.getRun(tenant,runId)).status,"queued");
  assert.equal((await sql`select state from harness_eval_dispatch_leases
    where organization_id=${tenant}`)[0].state,"dispatching");
  // Revoked Key Vault secret rejects a subsequent lookup without touching provider.
  enabled=false;
  await assert.rejects(()=>reconcile.inspectAndRecord({...args,observationId:"azure-revoked"}));
  assert.equal(actualStatusRequests,1);
  assert.equal((await sql`select count(*)::int as n from
    harness_eval_reconciliation_observations where organization_id=${tenant}`)[0].n,1);
  assert.ok(vaultRequests.length>=4);
  assert.ok(federationCalls>=4);
  const configRow=await sql`select secret_ref,status from harness_status_connector_configs
    where organization_id=${tenant}`;
  assert.equal(configRow[0].secret_ref,ref);
  assert.equal(configRow[0].status,"active");
  await sql`delete from organizations where id=${tenant}`;tenant=null;
  assert.equal((await sql`select count(*)::int as n from
    harness_status_connector_configs`)[0].n,0);
  console.log(JSON.stringify({azureVaultIntegration:"passed",checks:[
    "disabled-default","scoped pinned key","explicit vault attestation",
    "tenant-owned egress","original idempotency","HMAC request and response",
    "metadata-only PostgreSQL evidence","revoked secret blocks lookup",
    "no provider auto-retry","cross-tenant denial","FK cascade"]}));
}finally{
  if(tenant)await sql`delete from organizations where id=${tenant}`;
  if(foreign)await sql`delete from organizations where id=${foreign}`;
  if(projectionRoot)await rm(projectionRoot,{recursive:true,force:true});
  await sql.end({timeout:5});
}
