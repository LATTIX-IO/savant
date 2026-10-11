import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, copyFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageBundle, archiveName } from "./release-publication.mjs";
import { parseEvidenceRequest, validateRemoteRelease, verifySignedAttestation,
  verifySourceReleaseEvidence, verifyRemoteTag, verifySuccessfulPublicationRun, ReleaseEvidenceError } from "./release-uat-evidence.mjs";
const SHA="a".repeat(40), REPO="LATTIX-IO/savant";
const request={version:"v0.1.0",commit:SHA,repository:REPO,runId:"124"};
const versioned=()=>({GITHUB_REPOSITORY:REPO,SAVANT_EVIDENCE_VERSION:request.version,
  SAVANT_EVIDENCE_COMMIT:SHA,SAVANT_EVIDENCE_RUN_ID:"124"});
function mockGit(command,args){
  assert.equal(command,"git");
  if(args[0]==="rev-parse")return Buffer.from(SHA+"\n");
  if(args[0]==="show")return Buffer.from('{"name":"savant","private":true,"version":"0.1.0"}');
  if(args[0]==="merge-base")return Buffer.alloc(0);
  if(args[0]==="archive")return Buffer.from("rehearsal tracked git tar bytes");
  throw Error("unknown_git_command");
}
function signed(digest,predicateType="https://slsa.dev/provenance/v1",runId=request.runId){
  return Buffer.from(JSON.stringify([{verificationResult:{
    signature:{certificate:{
      runInvocationURI:"https://github.com/"+REPO+"/actions/runs/"+runId+"/attempts/1"
    }},
    statement:{predicateType,subject:[{name:archiveName(request.version),digest:{sha256:digest}}]}
  }}]));
}
function fixture(){
  const stage=mkdtempSync(join(tmpdir(),"savant-uat-test-"));
  const prov=stageBundle(request,{output:stage,executor:mockGit});
  const assets=Object.entries(prov.files).map(([name,value])=>({
    name,digest:"sha256:"+value.sha256,size:value.bytes
  }));
  const metadata={tag_name:request.version,draft:false,prerelease:false,assets};
  return {stage,prov,assets,metadata,cleanup:()=>rmSync(stage,{recursive:true,force:true})};
}
const response=(metadata,status=200)=>new Response(metadata?JSON.stringify(metadata):null,{status});

const remoteRead=(f,{metadata=f.metadata,tag={type:"commit",sha:SHA},releaseStatus=200,
  runChanges={},jobsChanges={},seen=[]}={})=>async(url,opts)=>{
  seen.push({url,opts});
  if(url.includes("/git/ref/tags/"))return response({object:tag});
  if(url.includes("/git/tags/"))return response({object:{type:"commit",sha:SHA}});
  if(url.includes("/actions/runs/"+request.runId+"/jobs"))return response({
    total_count:2,jobs:[
      {name:"Verify, test and attest tagged source",status:"completed",conclusion:"success"},
      {name:"Publish only after protected environment approval",status:"completed",conclusion:"success"}
    ],...jobsChanges
  });
  if(url.includes("/actions/runs/"+request.runId))return response({
    id:Number(request.runId),head_sha:SHA,
    path:".github/workflows/publish-source-release.yml",
    head_branch:"main",event:"workflow_dispatch",status:"completed",
    conclusion:"success",repository:{full_name:REPO},...runChanges
  });
  if(releaseStatus!==200)return new Response(null,{status:releaseStatus});
  return response(metadata);
};

function fakeRunner(f,{attestation=signed(f.prov.sha256),tamper=()=>{},log=[]}={}){
  return (cmd,args)=>{
    assert.equal(cmd,"gh");
    log.push(args);
    if(args[0]==="release"){
      assert.deepEqual(args.slice(0,3),["release","download",request.version]);
      assert.ok(args.includes("--repo") && args.includes(REPO));
      const dir=args[args.indexOf("--dir")+1];
      for(const a of f.assets) copyFileSync(join(f.stage,a.name),join(dir,a.name));
      tamper(dir);
      return Buffer.alloc(0);
    }
    if(args[0]==="attestation"){
      assert.equal(args[1],"verify");
      assert.ok(args.includes("--source-digest") && args.includes(SHA));
      assert.ok(args.includes("--source-ref") && args.includes("refs/heads/main"));
      assert.ok(args.includes("--signer-workflow"));
      assert.ok(args.some(a=>a.includes(".github/workflows/publish-source-release.yml")));
      assert.ok(args.includes("--deny-self-hosted-runners"));
      assert.ok(args.includes("--format") && args.includes("json"));
      return attestation;
    }
    throw Error("mutating_or_unexpected_gh_command");
  };
}
const options=(f,more={})=>({
  token:"read-only-evidence-token",
  fetcher:remoteRead(f),
  git:mockGit,
  runner:fakeRunner(f),
  ...more
});
test("PER-1291 requires fixed repository and validated version/SHA/run evidence",()=>{
  assert.deepEqual(parseEvidenceRequest(versioned()),request);
  for(const variant of [
    {GITHUB_REPOSITORY:"attacker/repo"},
    {SAVANT_EVIDENCE_VERSION:"v0.1.0;echo unsafe"},
    {SAVANT_EVIDENCE_VERSION:"v0.1.0\n"},
    {SAVANT_EVIDENCE_COMMIT:"bad"},
    {SAVANT_EVIDENCE_RUN_ID:"0"},
    {SAVANT_EVIDENCE_RUN_ID:"123\nMALICIOUS=1"}
  ])assert.throws(()=>parseEvidenceRequest({...versioned(),...variant}),/repository_not_allowed|invalid_evidence_request/);
});
test("PER-1291 rejects draft, missing/extra assets, forged sizes and digest omissions",()=>{
  const f=fixture();
  try{
    const remote={tagName:request.version,isDraft:false,isPrerelease:false,assets:f.assets};
    assert.equal(validateRemoteRelease(remote,request),true);
    for(const mutation of [
      {isDraft:true},{tagName:"v0.2.0"},{isPrerelease:true},
      {assets:remote.assets.slice(0,2)},
      {assets:[...remote.assets,{name:"extra",digest:"sha256:"+SHA+"a".repeat(24),size:1}]},
      {assets:remote.assets.map((a,i)=>i? a:{...a,size:-1})},
      {assets:remote.assets.map((a,i)=>i? a:{...a,digest:undefined})}
    ])assert.throws(()=>validateRemoteRelease({...remote,...mutation},request),ReleaseEvidenceError);
    assert.throws(()=>validateRemoteRelease(null,request),/release_not_published/);
  }finally{f.cleanup();}
});
test("PER-1291 attestation requires a nonempty signed SLSA subject for the exact archive digest",()=>{
  const digest="f".repeat(64);
  assert.equal(verifySignedAttestation(signed(digest),digest,request),true);
  for(const value of [
    Buffer.from("[]"), Buffer.from("{broken"),Buffer.from("null"),
    Buffer.from(JSON.stringify([{verificationResult:{}}])),
    signed("e".repeat(64)),signed(digest,"https://wrong.example/predicate"),
    signed(digest,"https://slsa.dev/provenance/v1","999"),
    Buffer.alloc(1024*1024+1,0)
  ])assert.throws(()=>verifySignedAttestation(value,digest,request),ReleaseEvidenceError);
});
test("PER-1291 read-only end-to-end rehearsal checks local archive, GitHub metadata and signer identity",async()=>{
  const f=fixture(),calls=[], network=[];
  try{
    const result=await verifySourceReleaseEvidence(request,options(f,{
      fetcher:remoteRead(f,{seen:network}),
      runner:fakeRunner(f,{log:calls})
    }));
    assert.equal(result.ready,true);
    assert.equal(result.schema,"savant.release-uat-evidence.v1");
    assert.equal(result.sha256,f.prov.sha256);
    assert.equal(result.workflowRunId,request.runId);
    assert.equal(result.assets.length,3);
    assert.ok(Object.values(result.checks).every(Boolean));
    assert.equal(network.length,4);
    assert.ok(network.every(x=>x.opts.redirect==="error" && x.opts.method==="GET" ||
      x.opts.redirect==="error" && x.opts.headers.Authorization==="Bearer read-only-evidence-token"));
    assert.equal(calls.length,2);
    assert.ok(calls.every(a=>a[0]==="release"&&a[1]==="download" ||
      a[0]==="attestation"&&a[1]==="verify"));
    assert.doesNotMatch(JSON.stringify(result),/token|private|certificate/i);
  }finally{f.cleanup();}
});
test("PER-1291 outages, untrusted tag and unreleased candidates prevent any downloads",async()=>{
  const f=fixture();
  try{
    let downloads=0;
    const runner=()=>{downloads++;throw Error("unsafe command");};
    await assert.rejects(verifySourceReleaseEvidence(request,options(f,{
      fetcher:remoteRead(f,{releaseStatus:404}),runner
    })),/release_not_published/);
    await assert.rejects(verifySourceReleaseEvidence(request,options(f,{
      fetcher:remoteRead(f,{releaseStatus:403}),runner
    })),/remote_release_unavailable/);
    await assert.rejects(verifySourceReleaseEvidence(request,options(f,{
      git:()=>{throw Error("injected git failure");},runner
    })),/tag_source_unverified/);
    await assert.rejects(verifySourceReleaseEvidence(request,options(f,{token:"",runner})),/missing_read_token/);
    assert.equal(downloads,0);
  }finally{f.cleanup();}
});
test("PER-1291 corrupted downloaded artifacts, provenance and remote digest mismatch fail before attest",async()=>{
  const f=fixture();
  try{
    for(const mutation of [
      dir=>writeFileSync(join(dir,archiveName(request.version)),Buffer.from("corrupt")),
      dir=>writeFileSync(join(dir,"SHA256SUMS"),"0".repeat(64)),
      dir=>writeFileSync(join(dir,"release-provenance.json"),'{"injected":true}'),
      dir=>writeFileSync(join(dir,"unexpected"),"extra")
    ]){
      let verified=0;
      await assert.rejects(verifySourceReleaseEvidence(request,options(f,{
        runner:(cmd,args)=>{
          if(args[0]==="attestation")verified++;
          return fakeRunner(f,{tamper:mutation})(cmd,args);
        }
      })),/download_integrity_failed/);
      assert.equal(verified,0);
    }
    const drift={...f.metadata,assets:f.assets.map((a,i)=>i? a:{...a,digest:"sha256:"+"b".repeat(64)})};
    let verify=0;
    await assert.rejects(verifySourceReleaseEvidence(request,options(f,{
      fetcher:remoteRead(f,{metadata:drift}),
      runner:(cmd,args)=>{
        if(args[0]==="attestation")verify++;
        return fakeRunner(f)(cmd,args);
      }
    })),/remote_digest_mismatch/);
    assert.equal(verify,0);
  }finally{f.cleanup();}
});
test("PER-1291 unsigned, mismatched signer subject or attestation provider failures fail closed",async()=>{
  const f=fixture();
  try{
    await assert.rejects(verifySourceReleaseEvidence(request,options(f,{
      runner:fakeRunner(f,{attestation:signed("0".repeat(64))})
    })),/attestation_subject_mismatch/);
    await assert.rejects(verifySourceReleaseEvidence(request,options(f,{
      runner:(cmd,args)=>{
        if(args[0]==="attestation")throw Error("untrusted signature");
        return fakeRunner(f)(cmd,args);
      }
    })),/signed_attestation_unverified/);
  }finally{f.cleanup();}
});
test("PER-1291 production verifier never creates, edits, deletes or dispatches a GitHub release",()=>{
  const src=readFileSync("scripts/release-uat-evidence.mjs","utf8");
  assert.doesNotMatch(src,/"release","create"|"release","edit"|"release","upload"|"workflow","run"/);
  assert.match(src,/--signer-workflow/);
  assert.match(src,/--source-digest/);
  assert.match(src,/--deny-self-hosted-runners/);
});

test("PER-1291 remote live tags accept direct/annotated refs but reject moved, absent and cyclic refs",async()=>{
  const f=fixture();
  try{
    const calls=[];
    assert.equal(await verifyRemoteTag(request,"read-only-evidence-token",remoteRead(f,{seen:calls})),true);
    assert.equal(calls.length,1);
    assert.equal(calls[0].opts.method,"GET");
    assert.equal(await verifyRemoteTag(request,"read-only-evidence-token",
      remoteRead(f,{tag:{type:"tag",sha:"b".repeat(40)}})),true);
    await assert.rejects(verifyRemoteTag(request,"read-only-evidence-token",
      remoteRead(f,{tag:{type:"commit",sha:"f".repeat(40)}})),/remote_tag_commit_mismatch/);
    await assert.rejects(verifyRemoteTag(request,"read-only-evidence-token",
      async()=>new Response(null,{status:404})),/remote_tag_unavailable/);
    await assert.rejects(verifyRemoteTag(request,"read-only-evidence-token",
      async()=>response({object:{type:"tag",sha:"b".repeat(40)}})),/remote_tag_invalid_response/);
    await assert.rejects(verifyRemoteTag(request,"read-only-evidence-token",
      async()=>response({object:{type:"unknown",sha:SHA}})),/remote_tag_invalid_response/);
  }finally{f.cleanup();}
});

test("PER-1291 refuse publishing-run mismatch, denied approval, incomplete jobs and falsely claimed run IDs",async()=>{
  const f=fixture();
  try{
    const invalid=[
      {runChanges:{head_sha:"f".repeat(40)}},
      {runChanges:{conclusion:"failure"}},
      {runChanges:{status:"in_progress"}},
      {runChanges:{event:"push"}},
      {runChanges:{path:".github/workflows/other.yml"}},
      {runChanges:{head_branch:"feature"}},
      {runChanges:{repository:{full_name:"attacker/other"}}},
      {runChanges:{inputs:{version:"v9.9.9",commit_sha:SHA,confirmation:"PUBLISH v9.9.9"}}},
      {runChanges:{inputs:{version:request.version,commit_sha:"f".repeat(40),confirmation:"PUBLISH "+request.version}}},
      {runChanges:{inputs:{version:request.version,commit_sha:SHA,confirmation:"PUBLISH wrong"}}},
      {jobsChanges:{jobs:[
        {name:"Verify, test and attest tagged source",status:"completed",conclusion:"success"},
        {name:"Publish only after protected environment approval",status:"completed",conclusion:"skipped"}
      ]}},
      {jobsChanges:{total_count:3}},
      {jobsChanges:{jobs:[]}}
    ];
    for(const override of invalid){
      await assert.rejects(verifySuccessfulPublicationRun(request,"read-only-evidence-token",
        remoteRead(f,override)),/workflow_run_unverified|workflow_jobs_unverified|workflow_run_input_mismatch/);
    }
    await assert.rejects(verifySuccessfulPublicationRun(request,"read-only-evidence-token",
      async()=>new Response(null,{status:403})),/workflow_run_unavailable/);
    assert.equal(await verifySuccessfulPublicationRun(request,"read-only-evidence-token",remoteRead(f)),true);
    assert.equal(await verifySuccessfulPublicationRun(request,"read-only-evidence-token",remoteRead(f,{
      runChanges:{inputs:{version:request.version,commit_sha:SHA,confirmation:"PUBLISH "+request.version}}
    })),true);
    const other=signed(f.prov.sha256,"https://slsa.dev/provenance/v1","998");
    assert.throws(()=>verifySignedAttestation(other,f.prov.sha256,request),/attestation_subject_mismatch/);
  }finally{f.cleanup();}
});
