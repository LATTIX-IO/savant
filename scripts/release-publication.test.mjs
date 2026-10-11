import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validatePublishRequest, assertTaggedSource, archiveName, validateBundle,
  stageBundle, classifyExistingRelease, verifyGitTag, digestOf
} from "./release-publication.mjs";
import { inspectExistingRelease, publishSourceRelease } from "./release-publish.mjs";
const COMMIT = "a".repeat(40);
const req = () => ({version:"v0.1.0",commit:COMMIT,repository:"LATTIX-IO/savant",runId:"1234"});
const valid = () => ({...req(),confirmation:"PUBLISH v0.1.0",enabled:"true",ref:"refs/heads/main",mainCommit:COMMIT});
function fakeGit(_command,args) {
  if(args[0]==="rev-parse") return Buffer.from(COMMIT + "\n");
  if(args[0]==="show") return Buffer.from(JSON.stringify({name:"savant",private:true,version:"0.1.0"}));
  if(args[0]==="merge-base") return Buffer.alloc(0);
  if(args[0]==="archive") return Buffer.from("mock uncompressed git archive content");
  throw Error("unexpected command");
}
function fixture() {
  const dir=mkdtempSync(join(tmpdir(),"savant-release-test-"));
  const request=req();
  const manifest=stageBundle(request,{output:dir,executor:fakeGit});
  return {dir,request,manifest,dispose:()=>rmSync(dir,{recursive:true,force:true})};
}
function existing(request,manifest) {
  return {tagName:request.version,isDraft:false,isPrerelease:false,assets:
    Object.entries(manifest.files).map(([name,entry])=>({name,size:entry.bytes,digest:"sha256:"+entry.sha256}))
  };
}
test("PER-1207: fail closed for unapproved, wrong-branch, malformed or forged releases",()=>{
  assert.deepEqual(validatePublishRequest(valid()),req());
  for(const mutation of [
    {enabled:"false"},{enabled:undefined},{confirmation:"PUBLISH v0.2.0"},
    {ref:"refs/heads/feature"},{ref:"refs/tags/v0.1.0"},
    {commit:"bad"},{commit:"A".repeat(40)},{mainCommit:"b".repeat(40)}, {version:"v0.1.0;rm -rf /"},
    {version:"v1.0.0\nINJECT=1"},{version:"v0.1.0\n"},{repository:"evil host/path"},
    {runId:"0"},{repository:"owner/.."},{repository:"./repo"}
  ])assert.throws(()=>validatePublishRequest({...valid(),...mutation}));
});
test("PER-1207: strict tag-to-commit and ancestry binding rejects replay or forged tag",()=>{
  const options={expectedCommit:COMMIT,taggedCommit:COMMIT,packageVersion:"0.1.0",version:"v0.1.0",isMainAncestor:true};
  assert.equal(assertTaggedSource(options),true);
  for(const mutation of [
    {taggedCommit:"b".repeat(40)},{isMainAncestor:false},{packageVersion:"0.2.0"},
    {expectedCommit:"b".repeat(40)}
  ])assert.throws(()=>assertTaggedSource({...options,...mutation}));
  assert.doesNotThrow(()=>verifyGitTag(req(),fakeGit));
  assert.throws(()=>verifyGitTag(req(),(cmd,args)=>{
    if(args[0]==="rev-parse")return Buffer.from("b".repeat(40)+"\n");
    return fakeGit(cmd,args);
  }),/tag_commit_mismatch/);
});
test("PER-1207: deterministic tagged source digest, bounded manifest and integrity",()=>{
  const a=fixture();const b=fixture();
  try {
    assert.equal(a.manifest.sha256,b.manifest.sha256);
    assert.equal(a.manifest.bytes,b.manifest.bytes);
    assert.equal(validateBundle(a.dir,a.request).digest,a.manifest.sha256);
    assert.match(readFileSync(join(a.dir,"SHA256SUMS"),"utf8"),new RegExp("^"+a.manifest.sha256));
    assert.notEqual(digestOf(Buffer.from("other artifact")),a.manifest.sha256);
    const tar=join(a.dir,archiveName(a.request.version));
    writeFileSync(tar,Buffer.from("tampered archive"));
    assert.throws(()=>validateBundle(a.dir,a.request),/integrity_failed/);
  }finally{a.dispose();b.dispose();}
});
test("PER-1207: reject untrusted bundle files and manifest identity drift",()=>{
  const f=fixture();
  try{
    writeFileSync(join(f.dir,"extra"),"injected");
    assert.throws(()=>validateBundle(f.dir,f.request),/unexpected_bundle/);
    rmSync(join(f.dir,"extra"));
    const file=join(f.dir,"release-provenance.json");
    const p=JSON.parse(readFileSync(file,"utf8"));
    p.commit="b".repeat(40);
    writeFileSync(file,JSON.stringify(p));
    assert.throws(()=>validateBundle(f.dir,f.request),/integrity_failed/);
  }finally{f.dispose();}
});
test("PER-1207: same digest and artifact set is replay-only, changed assets fail closed",()=>{
  const f=fixture();
  try{
    assert.equal(classifyExistingRelease(null,f.request,f.manifest),"create");
    assert.equal(classifyExistingRelease(existing(f.request,f.manifest),f.request,f.manifest),"unchanged");
    for(const mutation of [
      {tagName:"v0.2.0"},{isDraft:true},
      {assets:[]},{assets:existing(f.request,f.manifest).assets.map(x=>({...x,digest:"sha256:"+ "d".repeat(64)}))}
    ]) assert.throws(()=>classifyExistingRelease({...existing(f.request,f.manifest),...mutation},f.request,f.manifest),/conflict/);
  }finally{f.dispose();}
});
test("PER-1207: reject mutated remote checksums, provenance, size, absent digests and wrong run identity",()=>{
  const f=fixture();
  try {
    for(const name of ["SHA256SUMS","release-provenance.json"]){
      const remote=existing(f.request,f.manifest);
      remote.assets.find(x=>x.name===name).digest="sha256:"+"e".repeat(64);
      assert.throws(()=>classifyExistingRelease(remote,f.request,f.manifest),/conflict/);
      const wrongSize=existing(f.request,f.manifest);
      wrongSize.assets.find(x=>x.name===name).size++;
      assert.throws(()=>classifyExistingRelease(wrongSize,f.request,f.manifest),/conflict/);
      const missingDigest=existing(f.request,f.manifest);
      delete missingDigest.assets.find(x=>x.name===name).digest;
      assert.throws(()=>classifyExistingRelease(missingDigest,f.request,f.manifest),/conflict/);
    }
    assert.throws(()=>validateBundle(f.dir,{...f.request,runId:"999"}),/integrity_failed/);
  } finally {f.dispose();}
});
test("PER-1207: release lookup distinguishes 404, denial and server failures",async()=>{
  assert.equal(await inspectExistingRelease(req(),"dummy",async()=>new Response(null,{status:404})),null);
  for(const status of [401,403,500,502]){
    await assert.rejects(inspectExistingRelease(req(),"dummy",async()=>new Response(null,{status})),/lookup_failed/);
  }
  await assert.rejects(inspectExistingRelease(req(),"",async()=>new Response(null,{status:404})),/missing_github_token/);
});
test("PER-1207: existing correct publication causes zero mutation; outage never publishes",async()=>{
  const f=fixture();let mutations=0;
  try{
    const response=()=>new Response(JSON.stringify({
      tag_name:f.request.version,draft:false,prerelease:false,
      assets:existing(f.request,f.manifest).assets
    }),{status:200});
    const done=await publishSourceRelease(f.request,{dir:f.dir,git:fakeGit,token:"dummy",fetcher:async()=>response(),
      runGh:()=>{mutations++;return Buffer.alloc(0);}});
    assert.equal(done.state,"existing_verified");assert.equal(mutations,0);
    await assert.rejects(publishSourceRelease(f.request,{dir:f.dir,git:fakeGit,token:"dummy",fetcher:async()=>new Response(null,{status:503}),
      runGh:()=>{mutations++;return Buffer.alloc(0);}}),/lookup_failed/);
    assert.equal(mutations,0);
  }finally{f.dispose();}
});
test("PER-1207: only manual protected job writes, verified attestation and no automatic trigger",()=>{
  const flow=readFileSync(".github/workflows/publish-source-release.yml","utf8");
  assert.match(flow,/^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(flow,/^\s*(push|pull_request|workflow_run|schedule):\s*$/m);
  assert.match(flow,/environment:\s*\n\s*name: savant-release/m);
  assert.match(flow,/vars\.SAVANT_RELEASE_PUBLISH_ENABLED/);
  assert.match(flow,/actions\/attest-build-provenance@[a-f0-9]{40}/);
  assert.match(flow,/gh attestation verify/);
  assert.match(flow,/^\s*contents: read\s*$/m);
  assert.match(flow,/^\s*contents: write\s*$/m);
  assert.match(flow,/id-token: write/);
  assert.match(flow,/fetch-depth: 0/);
  assert.match(flow,/pnpm security:scan/);
  assert.match(flow,/node scripts\/release-preflight\.mjs/);
  assert.ok(flow.indexOf("node scripts/release-preflight.mjs") < flow.indexOf("pnpm install"));
  assert.doesNotMatch(flow,/^\s*if:\s*github.ref\s*==/m);
  assert.doesNotMatch(flow,/--force|git push|git tag -f|release delete/);
});

test("PER-1207: authorized new release publishes exactly once and checks server digest",async()=>{
  const f=fixture();let calls=0,created=0,args;
  try{
    const result=await publishSourceRelease(f.request,{dir:f.dir,git:fakeGit,token:"dummy",
      fetcher:async()=>{
        calls++;
        return calls===1 ? new Response(null,{status:404}) :
          new Response(JSON.stringify({tag_name:f.request.version,draft:false,prerelease:false,assets:existing(f.request,f.manifest).assets}),{status:200});
      },
      runGh:(_exe,passed)=>{created++;args=passed;return Buffer.from("");}
    });
    assert.equal(result.state,"published_verified");
    assert.equal(calls,2);
    assert.equal(created,1);
    assert.ok(args.includes("--verify-tag"));
    assert.ok(args.includes("--target"));
    assert.ok(args.includes(f.request.commit));
    assert.ok(args.some(s=>String(s).endsWith("SHA256SUMS")));
    assert.ok(!args.includes("--clobber"));
  }finally{f.dispose();}
});
test("PER-1207: publication race accepts identical remote and rejects changed digest",async()=>{
  const f=fixture();
  try{
    let calls=0;
    const result=await publishSourceRelease(f.request,{dir:f.dir,git:fakeGit,token:"dummy",
      fetcher:async()=>{
        calls++;
        return calls===1?new Response(null,{status:404}):
          new Response(JSON.stringify({tag_name:f.request.version,draft:false,prerelease:false,assets:existing(f.request,f.manifest).assets}),{status:200});
      },
      runGh:()=>{throw Error("release already exists");}
    });
    assert.equal(result.state,"existing_verified");
    let after=0;
    await assert.rejects(publishSourceRelease(f.request,{dir:f.dir,git:fakeGit,token:"dummy",
      fetcher:async()=>++after===1?new Response(null,{status:404}):
        new Response(JSON.stringify({tag_name:f.request.version,draft:false,prerelease:false,
          assets:existing(f.request,{...f.manifest,files:{...f.manifest.files,[archiveName(f.request.version)]:{...f.manifest.files[archiveName(f.request.version)],sha256:"e".repeat(64)}}}).assets}),{status:200}),
      runGh:()=>{throw Error("raced");}
    }),/conflict/);
  }finally{f.dispose();}
});
