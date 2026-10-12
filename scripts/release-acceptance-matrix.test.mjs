import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AcceptanceMatrixError,parseAcceptanceMatrixRequest,validateMatrixEvidence,
  runReleaseAcceptanceMatrix
} from "./release-acceptance-matrix.mjs";
const REPO="LATTIX-IO/savant",SHA="a".repeat(40);
function env(){
  return {
    GITHUB_REPOSITORY:REPO,GH_TOKEN:"test-release-read-token",
    SAVANT_GOVERNANCE_EVIDENCE_TOKEN:"separate-admin-evidence-token",
    SAVANT_ACCEPT_SUCCESS_VERSION:"v0.1.0",
    SAVANT_ACCEPT_SUCCESS_COMMIT:SHA,
    SAVANT_ACCEPT_SUCCESS_RUN_ID:"101",
    SAVANT_ACCEPT_PREFLIGHT_VERSION:"v0.1.1",
    SAVANT_ACCEPT_PREFLIGHT_COMMIT:SHA,
    SAVANT_ACCEPT_PREFLIGHT_RUN_ID:"102",
    SAVANT_ACCEPT_DENIAL_VERSION:"v0.1.2",
    SAVANT_ACCEPT_DENIAL_COMMIT:SHA,
    SAVANT_ACCEPT_DENIAL_RUN_ID:"103"
  };
}
const governanceNames=[
  "main_default_branch","main_protected","main_review_rules",
  "version_tag_immutable","environment_reviewers","self_review_prevented",
  "environment_main_only","publication_state_matches_expected"
];
const positiveNames=[
  "tagCommit","remoteTag","releaseAssets","checksums","provenance",
  "remoteDigests","workflowRun","independentEnvironmentApproval","signedAttestation"
];
const negativeNames=[
  "runIdentity","unsuccessfulRun","publicationNotSuccessful",
  "scenarioEvidence","targetReleaseAbsent"
];
function fixtures(request=parseAcceptanceMatrixRequest(env())){
  const booleans = names=>Object.fromEntries(names.map(name=>[name,true]));
  return {
    governance:{
      schema:"savant.release-controls.audit.v2",repository:REPO,
      mode:"audit",ready:true,problems:[],checks:booleans(governanceNames)
    },
    successful:{
      schema:"savant.release-uat-evidence.v2",repository:REPO,ready:true,
      version:request.positive.version,commit:request.positive.commit,
      workflowRunId:request.positive.runId,sha256:"b".repeat(64),
      verifiedSignerWorkflow:"github.com/LATTIX-IO/savant/.github/workflows/publish-source-release.yml",
      assets:[
        {name:"savant-"+request.positive.version+".tar.gz",sha256:"b".repeat(64),bytes:200},
        {name:"SHA256SUMS",sha256:"c".repeat(64),bytes:72},
        {name:"release-provenance.json",sha256:"d".repeat(64),bytes:350}
      ],checks:booleans(positiveNames)
    },
    preflight:{
      schema:"savant.release-negative-uat.v1",ready:true,repository:REPO,
      version:request.preflight.version,commit:request.preflight.commit,
      workflowRunId:request.preflight.runId,scenario:"preflight_denied",
      checks:booleans(negativeNames)
    },
    approval:{
      schema:"savant.release-negative-uat.v1",ready:true,repository:REPO,
      version:request.approval.version,commit:request.approval.commit,
      workflowRunId:request.approval.runId,scenario:"approval_denied",
      checks:booleans(negativeNames)
    }
  };
}
function services(e=env(),calls=[]){
  const f=fixtures(parseAcceptanceMatrixRequest(e));
  return {
    governance:async (g,options)=>{
      calls.push(["governance",g,options]);
      return f.governance;
    },
    successful:async (request,options)=>{
      calls.push(["successful",request,options]);
      return f.successful;
    },
    negative:async(request,options)=>{
      calls.push([request.scenario,request,options]);
      return request.scenario==="preflight_denied"?f.preflight:f.approval;
    }
  };
}
test("PER-1371 accepts a full live-observed matrix with independent run/version references",async()=>{
  const e=env(),calls=[];
  const result=await runReleaseAcceptanceMatrix(e,services(e,calls));
  assert.equal(result.ready,true);
  assert.equal(result.schema,"savant.release-acceptance-matrix.v1");
  assert.equal(result.currentGovernanceMode,"audit");
  assert.equal(result.publicationEnabled,false);
  assert.equal(result.successful.sha256,"b".repeat(64));
  assert.deepEqual(result.negative.map(x=>x.scenario),["preflight_denied","approval_denied"]);
  assert.ok(Object.values(result.checks).every(x=>x===true));
  assert.deepEqual(secondCalls.map(x=>x[0]),["governance","successful","preflight_denied","approval_denied"]);
  assert.equal(calls[0][1].SAVANT_GOVERNANCE_MODE,"audit");
  assert.equal(calls[0][1].GH_TOKEN,e.SAVANT_GOVERNANCE_EVIDENCE_TOKEN);
  for(const entry of calls.slice(1))assert.equal(entry[2].token,e.GH_TOKEN);
  assert.doesNotMatch(JSON.stringify(result),/test-release-read-token|separate-admin-evidence-token|reviewer|private/i);
});
test("PER-1371 rejects missing/unsafe refs, incorrect repo, missing source SHA and unknown versions before network",async()=>{
  const mutations=[
    {GITHUB_REPOSITORY:"attacker/repo"},
    {SAVANT_ACCEPT_SUCCESS_VERSION:"v1.0.0;echo unsafe"},
    {SAVANT_ACCEPT_PREFLIGHT_VERSION:"v1.0.0\n"},
    {SAVANT_ACCEPT_DENIAL_COMMIT:"bad"},
    {SAVANT_ACCEPT_DENIAL_RUN_ID:"0"},
    {SAVANT_ACCEPT_SUCCESS_RUN_ID:"01"},
    {SAVANT_ACCEPT_PREFLIGHT_RUN_ID:"abc"},
    {SAVANT_ACCEPT_SUCCESS_VERSION:undefined}
  ];
  for(const mutation of mutations){
    const value={...env(),...mutation};
    assert.throws(()=>parseAcceptanceMatrixRequest(value),AcceptanceMatrixError);
    let calls=0;
    await assert.rejects(runReleaseAcceptanceMatrix(value,{
      governance:async()=>{calls++;throw Error("should not execute");}
    }),AcceptanceMatrixError);
    assert.equal(calls,0);
  }
});
test("PER-1371 duplicate or reused tag/run ID cannot satisfy distinct positive and negative UAT",()=>{
  const mutations=[
    {SAVANT_ACCEPT_PREFLIGHT_VERSION:"v0.1.0"},
    {SAVANT_ACCEPT_DENIAL_VERSION:"v0.1.0"},
    {SAVANT_ACCEPT_DENIAL_VERSION:"v0.1.1"},
    {SAVANT_ACCEPT_DENIAL_RUN_ID:"101"},
    {SAVANT_ACCEPT_PREFLIGHT_RUN_ID:"101"},
    {SAVANT_ACCEPT_DENIAL_RUN_ID:"102"}
  ];
  for(const mutation of mutations)assert.throws(
    ()=>parseAcceptanceMatrixRequest({...env(),...mutation}),/matrix_evidence_reused/
  );
});
test("PER-1371 rejects shared, missing or newline-bearing credentials without contacting GitHub",async()=>{
  for(const changes of [
    {GH_TOKEN:""},
    {SAVANT_GOVERNANCE_EVIDENCE_TOKEN:""},
    {GH_TOKEN:"secret\nunsafe"},
    {SAVANT_GOVERNANCE_EVIDENCE_TOKEN:"separate-admin-evidence-token\r"},
    {GH_TOKEN:"separate-admin-evidence-token"}
  ]){
    let calls=0;
    await assert.rejects(runReleaseAcceptanceMatrix({...env(),...changes},{
      governance:async()=>{calls++;return {};}
    }),AcceptanceMatrixError);
    assert.equal(calls,0);
  }
});
test("PER-1371 never invokes positive/negative release checks if the disabled governance audit is not ready",async()=>{
  const e=env(),calls=[],s=services(e,calls);
  s.governance=async(...args)=>{
    calls.push(["governance",...args]);
    return {...fixtures().governance,ready:false};
  };
  await assert.rejects(runReleaseAcceptanceMatrix(e,s),/matrix_governance_unverified/);
  assert.deepEqual(calls.map(x=>x[0]),["governance"]);
  const secondaryCalls=[];
  const corrupt=services(e,secondaryCalls);
  corrupt.governance=async()=>({...fixtures().governance,
    checks:{...fixtures().governance.checks,publication_state_matches_expected:false}});
  await assert.rejects(runReleaseAcceptanceMatrix(e,corrupt),/matrix_incomplete_checks/);
});
test("PER-1371 rejects spoofed ready governance, incomplete boolean matrix or a publish-mode flag",()=>{
  const request=parseAcceptanceMatrixRequest(env());
  const f=fixtures(request);
  const variants=[
    {mode:"publish"},{ready:false},{problems:["main_protected"]},
    {repository:"attacker/other"},{schema:"savant.release-controls.audit.v1"},
    {checks:{...f.governance.checks,main_protected:false}},
    {checks:{...f.governance.checks,main_protected:1}},
    {checks:{...f.governance.checks,unexpected:true}}
  ];
  for(const v of variants)assert.throws(()=>validateMatrixEvidence(request,{
    ...f,governance:{...f.governance,...v}
  }),AcceptanceMatrixError);
});
test("PER-1371 rejects forged success and stale run, missing signer check, wrong asset and malformed digest",()=>{
  const request=parseAcceptanceMatrixRequest(env());
  const f=fixtures(request);
  for(const change of [
    {schema:"savant.release-uat-evidence.v1"},
    {ready:false},{version:"v1.0.0"},{commit:"b".repeat(40)},
    {workflowRunId:"107"},
    {checks:{...f.successful.checks,signedAttestation:false}},
    {checks:{...f.successful.checks,independentEnvironmentApproval:undefined}},
    {sha256:"0"},
    {verifiedSignerWorkflow:"github.com/attacker/repo/.github/workflows/fake.yml"},
    {assets:f.successful.assets.map((a,i)=>i===0?{...a,sha256:"c".repeat(64)}:a)},
    {assets:[...f.successful.assets, f.successful.assets[0]]},
    {assets:f.successful.assets.map((a,i)=>i===0?{...a,name:"../../secret"}:a)},
    {assets:f.successful.assets.map((a,i)=>i===0?{...a,bytes:-5}:a)}
  ])assert.throws(()=>validateMatrixEvidence(request,{...f,successful:{...f.successful,...change}}),AcceptanceMatrixError);
});
test("PER-1371 negative reports are strictly matched to scenario, version, run ID and all five checks",()=>{
  const request=parseAcceptanceMatrixRequest(env());
  const f=fixtures(request);
  for(const key of ["preflight","approval"]){
    for(const update of [
      {version:"v7.0.0"},{workflowRunId:"999"},{commit:"b".repeat(40)},
      {schema:"savant.release-negative-uat.v0"},{ready:false},
      {scenario:key==="preflight"?"approval_denied":"preflight_denied"},
      {checks:{...f[key].checks,targetReleaseAbsent:false}},
      {checks:{...f[key].checks,publicationNotSuccessful:"true"}}
    ])assert.throws(()=>validateMatrixEvidence(request,{...f,[key]:{...f[key],...update}}),AcceptanceMatrixError);
  }
});
test("PER-1371 upstream API rejection is sanitized and stops subsequent verifiers",async()=>{
  const e=env(), calls=[], s=services(e,calls);
  s.successful=async()=>{calls.push(["successful"]);throw Error("secret token=not-for-log");};
  await assert.rejects(runReleaseAcceptanceMatrix(e,s),x=>
    x instanceof AcceptanceMatrixError &&
    x.code==="matrix_live_evidence_unavailable" && !x.message.includes("secret"));
  assert.deepEqual(calls.map(x=>x[0]),["governance","successful"]);
  const secondCalls=[];
  const f=services(e,secondCalls);
  f.negative=async r=>{
    secondCalls.push([r.scenario]);
    if(r.scenario==="approval_denied")throw Error("HTTP private response");
    return fixtures().preflight;
  };
  await assert.rejects(runReleaseAcceptanceMatrix(e,f),/matrix_live_evidence_unavailable/);
  assert.deepEqual(calls.map(x=>x[0]),["governance","successful","preflight_denied","approval_denied"]);
});
test("PER-1371 evidence matrix code contains no publishing, admin mutation or workflow dispatch",()=>{
  const source=readFileSync("scripts/release-acceptance-matrix.mjs","utf8");
  assert.doesNotMatch(source,/"release","create"|"workflow","run"|"release","delete"|method:\s*"POST"/);
  assert.match(source,/SAVANT_GOVERNANCE_MODE:"audit"/);
  assert.match(source,/verifyNegativeReleaseEvidence/);
  assert.match(source,/verifySourceReleaseEvidence/);
  assert.doesNotMatch(source,/SAVANT_RELEASE_PUBLISH_ENABLED\s*=\s*["']true/);
});
