import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {queueEvalGeneration} from "../src/server/jobs/enqueue.ts";
import {createEvalGenerationStore} from "../src/server/jobs/stores.ts";
import {UnpinnedEvaluationSourceError,requirePinnedEvaluationCommit}
  from "../src/server/jobs/eval-source-revision.ts";

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl||process.env.SAVANT_EVAL_SOURCE_TEST!=="1"||
   !["localhost","127.0.0.1","::1"].includes(new URL(databaseUrl).hostname)) {
  throw new Error("Explicit isolated local PostgreSQL acceptance environment required.");
}
const sql=postgres(databaseUrl,{max:4,prepare:false});
const suffix=randomUUID().slice(0,8);
const A="a".repeat(40),B="b".repeat(40);
const sourcePath="skills/eval-pinned";
const skillId="eval-pinned-"+suffix;
let tenant=null,foreign=null;
try {
 const [a]=await sql`insert into organizations (slug,display_name)
  values (${"eval-pinned-"+suffix},'Eval pinned') returning id`;
 const [b]=await sql`insert into organizations (slug,display_name)
  values (${"eval-foreign-"+suffix},'Eval foreign') returning id`;
 tenant=a.id;foreign=b.id;
 const [repo]=await sql`insert into repositories
   (organization_id,provider_type,owner_name,repo_name,default_branch)
   values (${tenant},'github','test-owner',${"eval-pinned-"+suffix},'main') returning id`;
 const [foreignRepo]=await sql`insert into repositories
   (organization_id,provider_type,owner_name,repo_name,default_branch)
   values (${foreign},'github','test-owner',${"eval-foreign-"+suffix},'main') returning id`;
 await sql`insert into indexed_skills
   (organization_id,repository_id,skill_id,display_name,tier,status,source_path,source_commit_sha,content_hash)
   values (${tenant},${repo.id},${skillId},'Pinned skill','tier1','active',${sourcePath},${A},'hash-test')`;

 const request={organizationId:tenant,repositoryId:repo.id,skillId,sourcePath,
   mode:"generate",trigger:"manual",requestedBy:"test-operator"};
 const queued=await queueEvalGeneration(sql,request);
 assert.equal(queued.status,"queued");
 assert.equal(queued.commitSha,A,"enqueue must store exact indexed source");
 const [job]=await sql`select payload,status from background_jobs where id=${queued.jobId}`;
 assert.equal(job.status,"queued");
 assert.equal(job.payload.runId,queued.id);

 // Adversarial race: default branch/index advances to B before async worker runs.
 await sql`update indexed_skills set source_commit_sha=${B},last_indexed_at=now()
   where organization_id=${tenant} and repository_id=${repo.id} and skill_id=${skillId}`;
 const stored=await createEvalGenerationStore(sql).get(tenant,queued.id);
 assert.equal(stored.commitSha,A,"queued evaluation must not follow mutable index");
 assert.equal(requirePinnedEvaluationCommit(stored.commitSha),A);
 const duplicate=await queueEvalGeneration(sql,request);
 assert.equal(duplicate.id,queued.id,"active run must not be replaced by a B-based duplicate");
 assert.equal(duplicate.commitSha,A);

 // A foreign tenant cannot select A's indexed version even when it supplies
 // the same repository ID, skill ID and path.
 await assert.rejects(()=>queueEvalGeneration(sql,{
   ...request,organizationId:foreign,repositoryId:repo.id,
 }),UnpinnedEvaluationSourceError);
 await assert.rejects(()=>queueEvalGeneration(sql,{
   ...request,organizationId:foreign,repositoryId:foreignRepo.id,
 }),UnpinnedEvaluationSourceError);
 await assert.rejects(()=>queueEvalGeneration(sql,{
   ...request,skillId:"not-indexed-"+suffix,
 }),UnpinnedEvaluationSourceError);
 const [foreignRuns]=await sql`select count(*)::int as n from eval_generation_runs
   where organization_id=${foreign}`;
 assert.equal(foreignRuns.n,0);
 const [foreignJobs]=await sql`select count(*)::int as n from background_jobs
   where organization_id=${foreign}`;
 assert.equal(foreignJobs.n,0);

 // A malformed indexed SHA must be rejected before adding any job or run.
 const unsafe="unsafe-"+suffix;
 await sql`insert into indexed_skills
   (organization_id,repository_id,skill_id,display_name,tier,status,source_path,source_commit_sha,content_hash)
   values (${tenant},${repo.id},${unsafe},'Unsafe skill','tier1','active','skills/unsafe','main','hash-test')`;
 await assert.rejects(()=>queueEvalGeneration(sql,{
   ...request,skillId:unsafe,sourcePath:"skills/unsafe",
 }),UnpinnedEvaluationSourceError);
 const [unsafeRun]=await sql`select count(*)::int as n from eval_generation_runs
   where organization_id=${tenant} and skill_id=${unsafe}`;
 assert.equal(unsafeRun.n,0);

 console.log(JSON.stringify({evalSourcePinning:"passed",checks:[
   "commit A pinned on queue","index advanced to B","persisted A invariant",
   "active run dedupe","foreign tenant denial","missing index denial",
   "malformed SHA fails before writes","tenant job isolation",
 ]}));
}finally {
 if(tenant)await sql`delete from organizations where id=${tenant}`;
 if(foreign)await sql`delete from organizations where id=${foreign}`;
 await sql.end({timeout:5});
}
