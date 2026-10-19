import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore}
  from "../src/server/test-bench/definition-store.ts";
import {TestBenchError}
  from "../src/server/test-bench/definition-contract.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_TEST_BENCH_SCHEMA_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
  throw Error("Isolated PostgreSQL and explicit test opt-in required.");
// Deterministic *test fixture*, not a production or externally usable secret.
process.env.TEST_BENCH_ENCRYPTION_KEY="11".repeat(32);
const sql=postgres(uri,{max:8,prepare:false});
const store=createTestBenchDefinitionStore(sql);
const unique=randomUUID().slice(0,8),shaA="a".repeat(40),shaB="b".repeat(40);
const skillId="bench-"+unique,sourcePath="skills/"+skillId;
const cases=[{caseId:"case-1",kind:"positive",prompt:"Never reveal the hidden token.",
  context:null,expectedBehavior:"Explain only the safe technique."}];
const code=(value)=>error=>error?.code===value;
let orgId=null,foreignId=null;
try{
 const [org]=await sql`insert into organizations(slug,display_name)
   values(${"tb-a-"+unique},'Test Bench Tenant A') returning id`;
 const [foreign]=await sql`insert into organizations(slug,display_name)
   values(${"tb-b-"+unique},'Test Bench Tenant B') returning id`;
 orgId=org.id;foreignId=foreign.id;
 const [repo]=await sql`insert into repositories
   (organization_id,provider_type,owner_name,repo_name,default_branch)
   values(${orgId},'github','test-bench',${"tb-a-"+unique},'main') returning id`;
 const [foreignRepo]=await sql`insert into repositories
   (organization_id,provider_type,owner_name,repo_name,default_branch)
   values(${foreignId},'github','test-bench',${"tb-b-"+unique},'main') returning id`;
 await sql`insert into indexed_skills
   (organization_id,repository_id,skill_id,display_name,tier,status,source_path,source_commit_sha,content_hash)
   values(${orgId},${repo.id},${skillId},'Test Bench','tier1','active',
   ${sourcePath},${shaA},'hash')`;
 const admin={organizationId:orgId,subject:"administrator",role:"admin"};
 const member={...admin,subject:"member",role:"member"};
 const outsider={organizationId:foreignId,subject:"other",role:"admin"};
 const requestId=randomUUID(),draft={name:"QA regression suite",cases,requestId};
 const created=await store.create(admin,skillId,draft);
 assert.equal(created.replayed,false);
 assert.equal(created.definition.revision,1);
 assert.equal(created.definition.sourceCommitSha,shaA);
 assert.deepEqual(created.definition.cases,cases);
 const [raw]=await sql`select cases_ciphertext,source_commit_sha,name
   from test_bench_definitions where id=${created.definition.id}`;
 assert.equal(raw.source_commit_sha,shaA);
 assert.ok(raw.cases_ciphertext.startsWith("v1:"));
 assert.ok(!raw.cases_ciphertext.includes(cases[0].prompt));
 assert.ok(!raw.cases_ciphertext.includes(cases[0].expectedBehavior));
 assert.equal((await store.list(member,skillId)).length,1);
 await assert.rejects(()=>store.update(member,skillId,created.definition.id,
   {...draft,expectedRevision:1}),code("PERMISSION_DENIED"));
 const replay=await store.create(admin,skillId,draft);
 assert.equal(replay.replayed,true);
 assert.equal(replay.definition.id,created.definition.id);
 await assert.rejects(()=>store.create(admin,skillId,{...draft,name:"changed"}),
   code("test_bench_idempotency_conflict"));
 assert.deepEqual(await store.list(outsider,skillId),[]);
 await assert.rejects(()=>store.get(outsider,skillId,created.definition.id),
   code("test_bench_not_found"));
 await assert.rejects(()=>store.update(outsider,skillId,created.definition.id,
   {...draft,expectedRevision:1}),code("test_bench_not_found"));
 await assert.rejects(()=>store.create(outsider,skillId,{...draft,requestId:randomUUID()}),
   code("test_bench_source_not_indexed"));
 await assert.rejects(()=>store.get(admin,"wrong-skill",created.definition.id),
   code("test_bench_not_found"));

 // Mutable default branch/index moves to B; existing definition remains A.
 await sql`update indexed_skills set source_commit_sha=${shaB},last_indexed_at=now()
   where organization_id=${orgId} and skill_id=${skillId}`;
 const updated=await store.update(admin,skillId,created.definition.id,{
  name:"QA regression v2",cases,expectedRevision:1,
 });
 assert.equal(updated.revision,2);
 assert.equal(updated.sourceCommitSha,shaA);
 await assert.rejects(()=>store.update(admin,skillId,created.definition.id,{
  name:"stale editor",cases,expectedRevision:1,
 }),code("test_bench_revision_conflict"));
 const simultaneous=await Promise.allSettled([
  store.update(admin,skillId,created.definition.id,{name:"editor-1",cases,expectedRevision:2}),
  store.update(admin,skillId,created.definition.id,{name:"editor-2",cases,expectedRevision:2}),
 ]);
 assert.equal(simultaneous.filter(x=>x.status==="fulfilled").length,1);
 assert.equal(simultaneous.filter(x=>x.status==="rejected"&&x.reason.code==="test_bench_revision_conflict").length,1);
 const latest=await store.get(admin,skillId,created.definition.id);
 assert.equal(latest.revision,3);
 assert.equal(latest.sourceCommitSha,shaA);

 // AAD revision tampering invalidates authenticated encryption.
 await sql`update test_bench_definitions set source_commit_sha=${shaB}
   where organization_id=${orgId} and id=${latest.id}`;
 await assert.rejects(()=>store.get(admin,skillId,latest.id),
   code("test_bench_integrity_failure"));
 await sql`update test_bench_definitions set source_commit_sha=${shaA}
   where organization_id=${orgId} and id=${latest.id}`;

 // Even privileged DB writers cannot attach foreign repository to tenant A.
 await assert.rejects(()=>sql`
   insert into test_bench_definitions
   (organization_id,repository_id,skill_id,source_path,source_commit_sha,name,
    cases_ciphertext,create_request_id,request_digest,created_by,updated_by)
   values(${orgId},${foreignRepo.id},${skillId},${sourcePath},${shaA},'bad',
   ${raw.cases_ciphertext},${randomUUID()},${"f".repeat(64)},'admin','admin')
 `,error=>error.code==="23503");

 const archived=await store.archive(admin,skillId,created.definition.id,3);
 assert.deepEqual(archived,{id:created.definition.id,revision:4,archived:true});
 assert.deepEqual(await store.list(admin,skillId),[]);
 await assert.rejects(()=>store.get(admin,skillId,created.definition.id),
   code("test_bench_not_found"));
 await assert.rejects(()=>store.create(admin,skillId,draft),
   code("test_bench_idempotency_conflict"));
 const [audit]=await sql`select count(*)::int as n from audit_events
   where organization_id=${orgId} and target_type='test_bench_definition'`;
 assert.equal(audit.n,4,"create+two committed updates+archive, no duplicate or stale audit");
 const auditText=JSON.stringify(await sql`select payload_redacted from audit_events
   where organization_id=${orgId} and target_type='test_bench_definition'`);
 assert.ok(!auditText.includes(cases[0].prompt));
 console.log(JSON.stringify({testBenchDefinitions:"passed",checks:[
  "encrypted-at-rest","immutable-SHA-A-after-index-B","exactly-once-create",
  "CAS-update","concurrent-stale-denial","cross-tenant-denial",
  "repository-tenant-FK","authenticated-encryption-AAD","soft-archive",
  "metadata-only-atomic-audit","no-plaintext-provider-inputs",
 ]}));
}finally{
 if(orgId)await sql`delete from organizations where id=${orgId}`;
 if(foreignId)await sql`delete from organizations where id=${foreignId}`;
 await sql.end({timeout:5});
}
