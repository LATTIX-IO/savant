import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import postgres from "postgres";
import {createTestBenchDefinitionStore} from "../src/server/test-bench/definition-store.ts";
import {createObservedRunStore} from "../src/server/test-bench/observed-run-store.ts";
import {createObservedComparisonStore} from "../src/server/test-bench/observed-run-comparison-store.ts";
import {executeQueuedObservedRun} from "../src/server/test-bench/observed-run-worker.ts";
import {OBSERVED_SCORING_FINGERPRINT} from "../src/server/test-bench/observed-evaluator.ts";

const uri=process.env.DATABASE_URL;
if(!uri||process.env.SAVANT_OBSERVED_COMPARISON_TEST!=="1"||
  !["localhost","127.0.0.1","::1"].includes(new URL(uri).hostname))
 throw Error("Observed comparison tests require explicit opt-in and isolated loopback Postgres");
process.env.TEST_BENCH_ENCRYPTION_KEY="14".repeat(32);
const sql=postgres(uri,{max:8,prepare:false});
const definitions=createTestBenchDefinitionStore(sql);
const runs=createObservedRunStore(sql);
const comparison=createObservedComparisonStore(sql);
const suffix=randomUUID().slice(0,8),shaA="a".repeat(40),shaB="b".repeat(40),
 shaC="c".repeat(40),skillId="comparison-"+suffix;
const caseSet=[{
 caseId:"test-1",kind:"positive",prompt:"PRIVATE_COMPARE_PROMPT",
 context:null,expectedBehavior:"PRIVATE_EXPECTED_RESULT",
}];
const hasCode=code=>error=>error?.code===code;
let orgId=null,foreignId=null;
try{
 const [org]=await sql`insert into organizations(slug,display_name)
   values(${"comparison-a-"+suffix},'Comparison Org A') returning id`;
 const [foreign]=await sql`insert into organizations(slug,display_name)
   values(${"comparison-b-"+suffix},'Comparison Org B') returning id`;
 orgId=org.id;foreignId=foreign.id;
 await sql`insert into users(organization_id,external_subject,email,display_name)
   values(${orgId},'owner',${"comparison-owner-"+suffix+"@example.test"},'Owner')`;
 const [repo]=await sql`insert into repositories(
   organization_id,provider_type,owner_name,repo_name,default_branch)
   values(${orgId},'github','comparison-test',${"repo-"+suffix},'main')
   returning id`;
 await sql`insert into indexed_skills(
   organization_id,repository_id,skill_id,display_name,tier,status,
   source_path,source_commit_sha,content_hash)
   values(${orgId},${repo.id},${skillId},'QA comparison','tier1','active',
     ${"skills/"+skillId},${shaA},'hash')`;
 const admin={organizationId:orgId,subject:"owner",role:"admin"};
 const member={organizationId:orgId,subject:"reader",role:"member"};
 const outsider={organizationId:foreignId,subject:"reader",role:"admin"};
 async function suiteAt(sha,cases,name){
  await sql`update indexed_skills set source_commit_sha=${sha},last_indexed_at=now()
    where organization_id=${orgId} and skill_id=${skillId}`;
  return (await definitions.create(admin,skillId,{
    requestId:randomUUID(),name,cases,
  })).definition;
 }
 const calls={nim:0,jev:0};
 async function completeSuite(suite){
  const accepted=(await runs.start(admin,skillId,suite.id,{
    requestId:randomUUID(),expectedRevision:1,
  })).run;
  const [job]=await sql`select * from background_jobs
    where id=(select job_id from test_bench_runs where id=${accepted.id})`;
  const ran=await executeQueuedObservedRun({
   sql,job:{id:job.id,organizationId:orgId,repositoryId:repo.id,
     kind:"test_bench_run",dedupeKey:accepted.id,
     payload:{runId:accepted.id},progress:{},attempts:1},
   queue:{release:async()=>{throw Error("unexpected queue release");}},
   deadline:Date.now()+230000,
   readInstructions:async(_org,_repo,_path,commitSha)=>{
     assert.equal(commitSha,suite.sourceCommitSha,"must use immutable admission SHA");
     return commitSha===shaB?"candidate instruction":"baseline instruction";
   },
   clients:()=>({
    executor:{model:"same-nim",async complete(messages){
      calls.nim++;
      const candidate=messages[0].content.includes("candidate instruction");
      return {content:candidate?"PRIVATE_CANDIDATE_OUTPUT":"PRIVATE_BASELINE_OUTPUT",
        model:"same-nim",latencyMs:candidate?20:40,
        usage:{promptTokens:85,completionTokens:15},
        finishReason:"stop",reasoningChars:0};
    }},
    judge:{model:"same-jev",async ask(state){
      calls.jev++;
      const candidate=state.output.includes("CANDIDATE");
      const score={type:"score",score:candidate?4:2,probabilities:{},confidence:1};
      const max={type:"score",score:4,probabilities:{},confidence:1};
      const yes={type:"noul",noul:1};
      return {
       model:"same-jev",latencyMs:10,usage:{inputTokens:85,outputTokens:15},
       answers:{quality:score,format_compliance:max,grounding_score:score,
         actionability:score,policy_compliance:yes,grounding_relevant:yes,
         expected_met:yes,
         revisions:{type:"choice",choice:"0",confidence:1,probabilities:{"0":1}}},
      };
    }},
   }),
  });
  assert.equal(ran,"done");
  const done=await runs.get(admin,skillId,suite.id,accepted.id);
  assert.equal(done.status,"complete");
  assert.equal(done.scorecard.scoringContract,OBSERVED_SCORING_FINGERPRINT);
  return done;
 }
 const defA=await suiteAt(shaA,caseSet,"Baseline suite");
 const runA=await completeSuite(defA);
 const defB=await suiteAt(shaB,caseSet,"Candidate suite");
 const runB=await completeSuite(defB);
 assert.equal(calls.nim,2);assert.equal(calls.jev,2);
 const visible=await comparison.list(member,skillId);
 assert.equal(visible.length,2);
 assert.deepEqual(new Set(visible.map(x=>x.sourceCommitSha)),new Set([shaA,shaB]));
 assert.ok(visible.every(x=>typeof x.overallScore==="number"&&x.caseCount===1));
 const beforeAudit=await sql`select count(*)::int as n from audit_events
   where organization_id=${orgId}`;
 const report=await comparison.compare(member,skillId,runA.id,runB.id);
 assert.equal(report.status,"descriptive_only");
 assert.equal(report.caseCount,1);
 assert.ok(report.overallScoreDelta>0);
 assert.equal(report.baseline.sourceCommitSha,shaA);
 assert.equal(report.candidate.sourceCommitSha,shaB);
 assert.equal(report.cases[0].caseId,"test-1");
 assert.ok(report.cases[0].qualityDeltaPoints>0);
 assert.ok(report.meanLatencyDeltaMs<0);
 assert.match(report.limitations,/Not statistically significant/);
 const resultText=JSON.stringify(report);
 for(const privateText of ["PRIVATE_COMPARE_PROMPT","PRIVATE_EXPECTED_RESULT",
   "PRIVATE_CANDIDATE_OUTPUT","PRIVATE_BASELINE_OUTPUT"]){
   assert.ok(!resultText.includes(privateText),"comparison may not expose prompts or outputs");
 }
 const afterAudit=await sql`select count(*)::int as n from audit_events
   where organization_id=${orgId}`;
 assert.equal(afterAudit[0].n,beforeAudit[0].n,"read-only compare must not create audit/mutations");
 await assert.rejects(()=>comparison.compare(outsider,skillId,runA.id,runB.id),
   hasCode("test_bench_comparison_unavailable"));
 await assert.rejects(()=>comparison.compare(member,skillId,runA.id,randomUUID()),
   hasCode("test_bench_comparison_unavailable"));
 await assert.rejects(()=>comparison.compare(member,skillId,runA.id,runA.id),
   hasCode("test_bench_comparison_request_invalid"));

 // Encrypted, different prompts cannot be made comparable by spoofing the case ID.
 const defC=await suiteAt(shaC,[{...caseSet[0],prompt:"DIFFERENT_PRIVATE_PROMPT"}],
  "Unmatched case suite");
 const runC=await completeSuite(defC);
 await assert.rejects(()=>comparison.compare(member,skillId,runA.id,runC.id),
   hasCode("test_bench_runs_not_comparable"));

 // Legacy scorecards without an immutable scoring contract are never reinterpreted.
 await sql`update test_bench_runs set scorecard=scorecard-'scoringContract'
   where organization_id=${orgId} and id=${runB.id}`;
 assert.equal((await comparison.list(member,skillId)).length,2);
 await assert.rejects(()=>comparison.compare(member,skillId,runA.id,runB.id),
   hasCode("test_bench_runs_not_comparable"));

 const [encrypted]=await sql`select snapshot_ciphertext,results_ciphertext
   from test_bench_runs where id=${runA.id}`;
 assert.match(encrypted.snapshot_ciphertext,/^v1:/);
 assert.match(encrypted.results_ciphertext,/^v1:/);
 assert.ok(!JSON.stringify(encrypted).includes("PRIVATE_COMPARE_PROMPT"));
 assert.ok(!JSON.stringify(encrypted).includes("PRIVATE_BASELINE_OUTPUT"));

 // Incomplete canceled runs must not surface as comparable metadata or deltas.
 const aborted=(await runs.start(admin,skillId,defB.id,{
   requestId:randomUUID(),expectedRevision:1,
 })).run;
 await runs.cancel(admin,skillId,defB.id,aborted.id,1);
 await assert.rejects(()=>comparison.compare(member,skillId,runA.id,aborted.id),
   hasCode("test_bench_comparison_unavailable"));
 assert.equal((await comparison.list(member,skillId)).length,2);

 console.log(JSON.stringify({observedComparison:"passed",checks:[
  "real encrypted provider-mock run A and B at immutable SHAs",
  "scorecard scoring contract pinned at worker completion",
  "tenant-authorized metadata-only run listing",
  "matching-case same-provider descriptive scorecard comparison",
  "cross-tenant run indistinguishability",
  "case drift and legacy scoring contract refusal",
  "incomplete/canceled cannot compare",
  "read-only comparison no audit or network/queue mutation",
  "encrypted prompts and provider outputs never returned",
 ]}));
}finally{
 if(orgId)await sql`delete from organizations where id=${orgId}`;
 if(foreignId)await sql`delete from organizations where id=${foreignId}`;
 await sql.end({timeout:5});
}
