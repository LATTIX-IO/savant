import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {encryptAIConnectionSecret} from "../src/server/control-plane/ai-connection-secrets.ts";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {executeQueuedObservedRun} from "../src/server/test-bench/observed-run-worker.ts";
import {
  TENANT_OPENAI_CHAT_ENDPOINT,assertTenantOpenAiCanContinue,createPinnedTenantOpenAiClient,
} from "../src/server/test-bench/tenant-openai-client.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_TENANT_OPENAI_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("Workspace OpenAI tests require isolated loopback database and explicit opt-in");
process.env.TEST_BENCH_ENCRYPTION_KEY="17".repeat(32);
process.env.AI_CONNECTION_ENCRYPTION_KEY="18".repeat(32);
const sql=postgres(uri,{max:8,prepare:false});
const definitions=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const suffix=randomUUID().slice(0,8),sha="a".repeat(40);
const skillId="tenant-openai-"+suffix,model="gpt-4o-mini-2024-07-18",
 apiKey="sk-PRIVATE_TENANT_KEY_FOR_TESTS_123456789";
const cases=[{
 caseId:"tenant-1",kind:"positive",prompt:"PRIVATE_TENANT_CASE",
 context:null,expectedBehavior:"say four",
}];
let orgId=null,foreignId=null;
const hasCode=code=>e=>e?.code===code;
function fakeJudge(){
 const score={type:"score",score:4,probabilities:{},confidence:1};
 const yes={type:"noul",noul:1};
 return {model:"jev-mock",async ask(){
  return {model:"jev-mock",latencyMs:15,
   usage:{inputTokens:50,outputTokens:15},
   answers:{
    quality:score,format_compliance:score,grounding_score:score,
    actionability:score,policy_compliance:yes,grounding_relevant:yes,
    expected_met:yes,
    revisions:{type:"choice",choice:"0",confidence:1,probabilities:{"0":1}},
   },
  };
 }};
}
try{
 const [org]=await sql`insert into organizations(slug,display_name)
  values(${"tenant-openai-a-"+suffix},'Tenant OpenAI A') returning id`;
 const [foreign]=await sql`insert into organizations(slug,display_name)
  values(${"tenant-openai-b-"+suffix},'Tenant OpenAI B') returning id`;
 orgId=org.id;foreignId=foreign.id;
 await sql`insert into users(organization_id,external_subject,email,display_name)
   values(${orgId},'owner',${"openai-"+suffix+"@example.test"},'Tenant owner')`;
 const [repo]=await sql`insert into repositories(
   organization_id,provider_type,owner_name,repo_name,default_branch)
   values(${orgId},'github','openai-test',${"repo-"+suffix},'main')
   returning id`;
 await sql`insert into indexed_skills(
   organization_id,repository_id,skill_id,display_name,tier,status,
   source_path,source_commit_sha,content_hash)
   values(${orgId},${repo.id},${skillId},'OpenAI','tier1','active',
    ${"skills/"+skillId},${sha},'hash')`;
 const admin={organizationId:orgId,subject:"owner",role:"admin"};
 const outsider={organizationId:foreignId,subject:"intruder",role:"admin"};
 const suite=(await definitions.create(admin,skillId,{
   name:"Real tenant OpenAI case",cases,requestId:randomUUID(),
 })).definition;
 const connectionId=randomUUID();
 const credential=encryptAIConnectionSecret(apiKey,{
  organizationId:orgId,aiConnectionId:connectionId,provider:"openai",
 });
 await sql`insert into ai_connections(
  id,organization_id,provider_type,display_name,default_model,purpose,usage_scope,
  allowed_models,supports_execution,supports_judging,is_default_execution,status,
  secret_ref)
  values(${connectionId},${orgId},'openai','Tenant OpenAI',${model},
  'QA','test-bench',${sql.json([model])}::jsonb,true,false,true,'active',
  ${"ai-connection:"+connectionId})`;
 await sql`insert into ai_connection_secrets(
  ai_connection_id,encrypted_secret,secret_fingerprint,algorithm,key_version)
  values(${connectionId},${credential.encryptedSecret},${credential.secretFingerprint},
  ${credential.algorithm},${credential.keyVersion})`;
 assert.equal((await runs.quota(admin)).admittedRuns,0);
 const requestId=randomUUID();
 const run=(await runs.start(admin,skillId,suite.id,{
  requestId,expectedRevision:1,executionSource:"workspace-openai",
 })).run;
 assert.equal(run.executionSource,"workspace-openai");
 assert.equal(run.costAccounting,"normalized-qa-proxy");
 assert.equal(run.executionModelPinned,model);
 assert.equal(run.status,"queued");
 assert.equal((await runs.quota(admin)).admittedRuns,1);
 const replay=await runs.start(admin,skillId,suite.id,{
  requestId,expectedRevision:1,executionSource:"workspace-openai",
 });
 assert.equal(replay.replayed,true);assert.equal(replay.run.id,run.id);
 assert.equal((await runs.quota(admin)).admittedRuns,1,
  "exact BYO replay must not charge tenant quota again");
 await assert.rejects(()=>runs.start(admin,skillId,suite.id,{
  requestId,expectedRevision:1,executionSource:"platform-nim",
 }),hasCode("test_bench_run_request_conflict"));
 await assert.rejects(()=>runs.start(outsider,skillId,suite.id,{
  requestId:randomUUID(),expectedRevision:1,executionSource:"workspace-openai",
 }),hasCode("test_bench_not_found"));
 const [raw]=await sql`select execution_source,execution_connection_id,
  execution_secret_fingerprint,execution_model_pinned,cost_accounting,
  snapshot_ciphertext,job_id from test_bench_runs where id=${run.id}`;
 assert.equal(raw.execution_connection_id,connectionId);
 assert.equal(raw.execution_secret_fingerprint,credential.secretFingerprint);
 assert.equal(raw.execution_model_pinned,model);
 assert.equal(raw.execution_source,"workspace-openai");
 assert.equal(raw.cost_accounting,"normalized-qa-proxy");

 // A valid connection ID owned by a different organization cannot be
 // attached to this run even by direct SQL metadata substitution.
 const foreignConnectionId=randomUUID();
 await sql`insert into ai_connections(
   id,organization_id,provider_type,display_name,default_model,purpose,
   usage_scope,secret_ref,status)
   values(${foreignConnectionId},${foreignId},'openai','Other organization',
     ${model},'QA','comparison',${"ai-connection:"+foreignConnectionId},'active')`;
 await assert.rejects(()=>sql`
   update test_bench_runs set execution_connection_id=${foreignConnectionId}
   where id=${run.id}
 `,error=>error?.code==="23503","composite tenant FK must refuse foreign credential");
 assert.match(raw.snapshot_ciphertext,/^v1:/);
 assert.ok(!JSON.stringify(raw).includes(apiKey));
 const [job]=await sql`select * from background_jobs where id=${raw.job_id}`;
 assert.deepEqual(job.payload,{runId:run.id});
 assert.ok(!JSON.stringify(job).includes(apiKey));
 assert.ok(!JSON.stringify(job).includes(model));
 let actualCalls=0;let judgeCalls=0;
 const observed=await executeQueuedObservedRun({
  sql,job:{id:job.id,organizationId:orgId,repositoryId:repo.id,
   kind:"test_bench_run",dedupeKey:run.id,payload:{runId:run.id},progress:{},attempts:1},
  queue:{release:async()=>{throw Error("unexpected release");}},
  deadline:Date.now()+230000,
  readInstructions:async(_org,_repo,_path,pinnedSha)=>{
   assert.equal(pinnedSha,sha);return "Answer the question with the number four.";
  },
  clients:async row=>{
   assert.equal(row.execution_source,"workspace-openai");
   const executor=await createPinnedTenantOpenAiClient(sql,row,async(url,init)=>{
    actualCalls++;
    assert.equal(url,TENANT_OPENAI_CHAT_ENDPOINT);
    assert.equal((init.headers).authorization,"Bearer "+apiKey);
    return new Response(JSON.stringify({
     model,choices:[{message:{content:"4"},finish_reason:"stop"}],
     usage:{prompt_tokens:90,completion_tokens:25},
    }),{status:200});
   });
   const judge=fakeJudge();
   return {executor,judge:{
    ...judge,async ask(...args){
     judgeCalls++;return judge.ask(...args);
    },
   }};
  },
 });
 assert.equal(observed,"done");assert.equal(actualCalls,1);assert.equal(judgeCalls,1);
 const completed=await runs.get(admin,skillId,suite.id,run.id);
 assert.equal(completed.status,"complete");
 assert.equal(completed.executionSource,"workspace-openai");
 assert.equal(completed.costAccounting,"normalized-qa-proxy");
 assert.equal(completed.samples.length,1);
 assert.equal(completed.samples[0].executionModel,model);
 assert.equal(completed.scorecard.sampleCount,1);
 const [rawResult]=await sql`select results_ciphertext,scorecard
   from test_bench_runs where id=${run.id}`;
 assert.match(rawResult.results_ciphertext,/^v1:/);
 assert.ok(!rawResult.results_ciphertext.includes("PRIVATE_TENANT_CASE"));
 assert.ok(!rawResult.results_ciphertext.includes(apiKey));

 // Missing managed encryption key must refuse decryption before network I/O.
 const keyForRestore=process.env.AI_CONNECTION_ENCRYPTION_KEY;
 delete process.env.AI_CONNECTION_ENCRYPTION_KEY;
 let absentKeyCalls=0;
 try{
   await assert.rejects(()=>createPinnedTenantOpenAiClient(sql,{
     organization_id:orgId,execution_source:"workspace-openai",
     execution_connection_id:connectionId,
     execution_model_pinned:model,
     execution_secret_fingerprint:credential.secretFingerprint,
   },async()=>{absentKeyCalls++;throw Error("NO NETWORK ON MISSING KEY");}),
    hasCode("test_bench_workspace_openai_credential_unavailable"));
 }finally{process.env.AI_CONNECTION_ENCRYPTION_KEY=keyForRestore;}
 assert.equal(absentKeyCalls,0);

 // Model allow-list mismatch must fail at admission and not reserve provider work.
 await sql`update ai_connections set allowed_models=${sql.json(["unauthorized"])}::jsonb
   where id=${connectionId}`;
 await assert.rejects(()=>runs.start(admin,skillId,suite.id,{
   requestId:randomUUID(),expectedRevision:1,executionSource:"workspace-openai",
 }),error=>hasCode("test_bench_workspace_openai_unavailable")(error)&&error.status===503);
 await sql`update ai_connections set allowed_models=${sql.json([model])}::jsonb
   where id=${connectionId}`;

 // Rotation between admission and execution must reject BEFORE a paid call.
 const rotated=(await runs.start(admin,skillId,suite.id,{
  requestId:randomUUID(),expectedRevision:1,executionSource:"workspace-openai",
 })).run;
 assert.equal((await runs.quota(admin)).admittedRuns,2);
 const newCredential=encryptAIConnectionSecret(apiKey+"-rotated",{
  organizationId:orgId,aiConnectionId:connectionId,provider:"openai",
 });
 await sql`update ai_connection_secrets set encrypted_secret=${newCredential.encryptedSecret},
  secret_fingerprint=${newCredential.secretFingerprint},updated_at=now()
  where ai_connection_id=${connectionId}`;
 const [rotateJob]=await sql`select * from background_jobs
  where id=(select job_id from test_bench_runs where id=${rotated.id})`;
 let afterRotateCalls=0;
 const denied=await executeQueuedObservedRun({
  sql,job:{id:rotateJob.id,organizationId:orgId,repositoryId:repo.id,
   kind:"test_bench_run",dedupeKey:rotated.id,payload:{runId:rotated.id},
   progress:{},attempts:1},
  queue:{release:async()=>{throw Error("unexpected");}},
  deadline:Date.now()+230000,
  readInstructions:async()=>{throw Error("no source read after key rotation");},
  clients:async()=>{afterRotateCalls++;throw Error("MUST NOT CALL PROVIDER");},
 });
 assert.equal(denied,"done");assert.equal(afterRotateCalls,0);
 assert.equal((await runs.get(admin,skillId,suite.id,rotated.id)).errorCode,
   "test_bench_workspace_openai_changed");

 // Revocation and default-change deny before any provider call.
 const revokeRun=(await runs.start(admin,skillId,suite.id,{
  requestId:randomUUID(),expectedRevision:1,executionSource:"workspace-openai",
 })).run;
 assert.equal((await runs.quota(admin)).admittedRuns,3);
 await sql`update ai_connections set status='revoked',is_default_execution=false
   where id=${connectionId}`;
 let afterRevokeCalls=0;
 const [revokeJob]=await sql`select * from background_jobs
  where id=(select job_id from test_bench_runs where id=${revokeRun.id})`;
 await executeQueuedObservedRun({
  sql,job:{id:revokeJob.id,organizationId:orgId,repositoryId:repo.id,
   kind:"test_bench_run",dedupeKey:revokeRun.id,payload:{runId:revokeRun.id},
   progress:{},attempts:1},
  queue:{release:async()=>{throw Error("unexpected");}},
  deadline:Date.now()+230000,
  readInstructions:async()=>{throw Error("revoked source read");},
  clients:async()=>{afterRevokeCalls++;throw Error("No provider after revoke");},
 });
 assert.equal(afterRevokeCalls,0);
 assert.equal((await runs.get(admin,skillId,suite.id,revokeRun.id)).status,"failed");
 assert.equal((await runs.quota(admin)).admittedRuns,3,
  "failed/rotated BYO requests must not refund daily capacity");
 await assert.rejects(()=>runs.start(admin,skillId,suite.id,{
  requestId:randomUUID(),expectedRevision:1,executionSource:"workspace-openai",
 }),hasCode("test_bench_workspace_openai_unavailable"));

 // No raw provider credentials in database job/audit records.
 const audit=JSON.stringify(await sql`select payload_redacted from audit_events
   where organization_id=${orgId} and target_type='test_bench_run'`);
 for(const secret of [apiKey,apiKey+"-rotated","PRIVATE_TENANT_CASE"])
  assert.ok(!audit.includes(secret));
 const serialized=JSON.stringify(await sql`select payload from background_jobs
   where organization_id=${orgId} and kind='test_bench_run'`);
 assert.ok(!serialized.includes(apiKey));
 assert.ok(!serialized.includes("PRIVATE_TENANT_CASE"));

 console.log(JSON.stringify({workspaceOpenAi:"passed",checks:[
  "default active OpenAI/allowed model and original tenant",
  "idempotent mode-pin admission and foreign-role denial",
  "encrypted AAD-bound credential used ONLY server-side",
  "fixed-origin one-call observed OpenAI plus Jev",
  "no secret in queue, DB run or audit",
  "rotation and revoke deny before source read/provider egress",
  "composite foreign-tenant FK prevents credential substitution",
  "missing vault key and model allow-list mismatch fail before I/O",
  "normalized QA cost proxy explicit, no platform NIM fallback",
  "BYO admission and idempotent replay count once against UTC tenant quota",
 ]}));
}finally{
 if(orgId)await sql`delete from organizations where id=${orgId}`;
 if(foreignId)await sql`delete from organizations where id=${foreignId}`;
 await sql.end({timeout:5});
}
