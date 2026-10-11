import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, renameSync, copyFileSync, linkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  stageBundle, validateBundle, verifyGitTag, run, archiveName, digestOf,
  validatePublishRequest
} from "./release-publication.mjs";
import { publishSourceRelease } from "./release-publish.mjs";

const PACKAGE = { name: "savant", version: "0.1.0", private: true };
const VERSION = "v0.1.0";
const SOURCE_ROOT = resolve("scripts");
function git(cwd, ...args) {
  return run("git", args, {cwd}).toString("utf8").trim();
}
function newFixture() {
  const root = mkdtempSync(join(tmpdir(), "savant-hermetic-release-"));
  const checkout = join(root, "checkout");
  mkdirSync(checkout);
  git(checkout, "init", "-q", "-b", "main");
  git(checkout, "config", "user.name", "Release Rehearsal");
  git(checkout, "config", "user.email", "release-rehearsal@example.invalid");
  mkdirSync(join(checkout, "src"));
  writeFileSync(join(checkout, "package.json"), JSON.stringify(PACKAGE) + "\n");
  writeFileSync(join(checkout, "src", "public.txt"), "tracked release payload\n");
  git(checkout, "add", "package.json", "src/public.txt");
  git(checkout, "commit", "-q", "-m", "rehearsal source");
  const sha = git(checkout, "rev-parse", "HEAD");
  git(checkout, "tag", "-a", VERSION, "-m", "release fixture");
  git(checkout, "update-ref", "refs/remotes/origin/main", sha);
  // These must never enter git archive, staging outputs or response bodies.
  writeFileSync(join(checkout, ".env.production"), "PRIVATE_TOKEN=never-archive-this\n");
  writeFileSync(join(checkout, "untracked-secret.txt"), "REHEARSAL_PRIVATE_SECRET\n");
  const request = { version: VERSION, commit: sha, repository: "LATTIX-IO/savant", runId: "9001" };
  return {
    root, checkout, request,
    executor: (command,args)=>run(command,args,{cwd:checkout}),
    cleanup: ()=>rmSync(root,{recursive:true,force:true})
  };
}
function tarEntries(compressed) {
  const bytes = gunzipSync(compressed);
  const entries = [];
  let cursor = 0;
  while (cursor + 512 <= bytes.length) {
    const header = bytes.subarray(cursor,cursor+512);
    if(header.every(x=>x===0))break;
    const name = header.subarray(0,100).toString("utf8").replace(/\0.*$/s, "");
    const rawSize = header.subarray(124,136).toString("ascii").replace(/\0.*$/s,"").trim();
    const size = parseInt(rawSize||"0",8);
    assert.ok(Number.isSafeInteger(size) && size>=0, "valid tar entry size");
    const content = bytes.subarray(cursor+512,cursor+512+size);
    entries.push({name,size,content});
    cursor += 512 + Math.ceil(size/512)*512;
  }
  return entries;
}
function approvalEnv(req) {
  return { ...process.env, GITHUB_REF:"refs/heads/main", GITHUB_SHA:req.commit,
    GITHUB_RUN_ID:req.runId, GITHUB_REPOSITORY:req.repository,
    SAVANT_RELEASE_PUBLISH_VERSION:req.version, SAVANT_PUBLISH_VERSION:req.version,
    SAVANT_PUBLISH_COMMIT:req.commit, SAVANT_RELEASE_PUBLISH_ENABLED:"true",
    SAVANT_PUBLISH_CONFIRMATION:"PUBLISH " + req.version };
}
function cli(script, fixture, envPatch={}) {
  return spawnSync(process.execPath,[join(SOURCE_ROOT,script)],{
    cwd:fixture.checkout, env:{...approvalEnv(fixture.request),...envPatch},
    encoding:"utf8", timeout:30000 });
}
function remote(request,bundle) {
  return { tag_name:request.version,draft:false,prerelease:false,
    assets:Object.entries(bundle.files).map(([name,file])=>({
      name, size:file.bytes, digest:"sha256:"+file.sha256
    })) };
}

test("PER-1220 real git: annotated tag preflight succeeds but refuses wrong source, disabled flag and missing tag",()=>{
  const f=newFixture();
  try {
    const ok=cli("release-preflight.mjs",f);
    assert.equal(ok.status,0,ok.stderr);
    assert.match(ok.stdout,/"published":false/);
    assert.equal(cli("release-preflight.mjs",f,{SAVANT_RELEASE_PUBLISH_ENABLED:"false"}).status,1);
    assert.equal(cli("release-preflight.mjs",f,{GITHUB_SHA:"b".repeat(40)}).status,1);
    assert.equal(cli("release-preflight.mjs",f,{GITHUB_REF:"refs/tags/v0.1.0"}).status,1);
    git(f.checkout,"tag","-d",VERSION);
    assert.notEqual(cli("release-preflight.mjs",f).status,0);
  } finally { f.cleanup(); }
});
test("PER-1220 real git: CLI stages deterministic tracked-only tarballs with independent digests",()=>{
  const f=newFixture();
  try {
    const stage=cli("release-stage.mjs",f);
    assert.equal(stage.status,0,stage.stderr);
    const primary=join(f.checkout,"dist","source-release");
    const checked=validateBundle(primary,f.request);
    const archive=readFileSync(join(primary,archiveName(VERSION)));
    const files=tarEntries(archive);
    const names=files.map(x=>x.name);
    assert.ok(names.includes("savant-0.1.0/package.json"),JSON.stringify(names));
    assert.ok(names.includes("savant-0.1.0/src/public.txt"),JSON.stringify(names));
    assert.ok(!names.some(x=>x.includes(".env")||x.includes("secret")||x.includes(".git/")));
    const publicText=files.find(x=>x.name==="savant-0.1.0/src/public.txt");
    assert.equal(publicText.content.toString("utf8"),"tracked release payload\n");
    const second=join(f.root,"second");
    const staged=stageBundle(f.request,{output:second,executor:f.executor});
    assert.equal(staged.sha256,checked.digest);
    assert.equal(digestOf(archive),staged.sha256);
    for(const name of [archiveName(VERSION),"SHA256SUMS","release-provenance.json"]) {
      assert.deepEqual(readFileSync(join(primary,name)),readFileSync(join(second,name)));
    }
  } finally { f.cleanup(); }
});
test("PER-1220 real git: moved tag, wrong tagged package version, unrelated main history fail closed",()=>{
  const f=newFixture();
  try {
    verifyGitTag(f.request,f.executor);
    writeFileSync(join(f.checkout,"package.json"),JSON.stringify({...PACKAGE,version:"0.2.0"}));
    git(f.checkout,"add","package.json");
    git(f.checkout,"commit","-q","-m","version drift");
    const changed=git(f.checkout,"rev-parse","HEAD");
    git(f.checkout,"tag","-f",VERSION,changed);
    assert.throws(()=>verifyGitTag(f.request,f.executor),/tag_commit_mismatch/);
    git(f.checkout,"tag","-f",VERSION,f.request.commit);
    assert.throws(()=>verifyGitTag({...f.request,commit:changed},f.executor),/tag_commit_mismatch/);
    const matchingNewVersion={...f.request,version:"v0.2.0",commit:changed};
    git(f.checkout,"tag","v0.2.0",changed);
    assert.throws(()=>verifyGitTag(matchingNewVersion,f.executor),/tag_not_on_main/);
    git(f.checkout,"update-ref","refs/remotes/origin/main",changed);
    assert.doesNotThrow(()=>verifyGitTag(matchingNewVersion,f.executor));
  } finally { f.cleanup(); }
});
test("PER-1220 tampering: archive, checksum, provenance, unexpected file and symlink cannot pass",()=>{
  const f=newFixture();
  try{
    const stageDir=join(f.root,"bundle");
    stageBundle(f.request,{output:stageDir,executor:f.executor});
    const archive=join(stageDir,archiveName(VERSION));
    const backup=readFileSync(archive);
    writeFileSync(archive,Buffer.from("corrupted"));
    assert.throws(()=>validateBundle(stageDir,f.request),/integrity/);
    writeFileSync(archive,backup);
    const sumPath=join(stageDir,"SHA256SUMS");
    const sum=readFileSync(sumPath);
    writeFileSync(sumPath,"0".repeat(64)+"  "+archiveName(VERSION)+"\n");
    assert.throws(()=>validateBundle(stageDir,f.request),/integrity/);
    writeFileSync(sumPath,sum);
    writeFileSync(sumPath,Buffer.alloc(1024*1024+1,120));
    assert.throws(()=>validateBundle(stageDir,f.request),/unsafe_bundle_entry/);
    writeFileSync(sumPath,sum);
    const provPath=join(stageDir,"release-provenance.json");
    const provenance=readFileSync(provPath);
    const forged=JSON.parse(provenance.toString("utf8"));
    forged.commit="b".repeat(40);
    writeFileSync(provPath,JSON.stringify(forged));
    assert.throws(()=>validateBundle(stageDir,f.request),/integrity/);
    writeFileSync(provPath,provenance);
    const surplus=join(stageDir,"untracked");
    writeFileSync(surplus,"unexpected");
    assert.throws(()=>validateBundle(stageDir,f.request),/unexpected_bundle/);
    rmSync(surplus);
    if(process.platform!=="win32"){
      const saved=join(f.root,"saved-archive.tar.gz");
      renameSync(archive,saved);
      symlinkSync(saved,archive);
      assert.throws(()=>validateBundle(stageDir,f.request),/unsafe_bundle_entry/);
      rmSync(archive);
      copyFileSync(saved,archive);
      const hardlink=join(f.root,"hardlinked-archive");
      linkSync(archive,hardlink);
      assert.throws(()=>validateBundle(stageDir,f.request),/unsafe_bundle_entry/);
    }
  }finally{f.cleanup();}
});
test("PER-1220 publish rehearsal: genuine archive, mocked GitHub create/readback, no external writes",async()=>{
  const f=newFixture();let creates=0,calls=0;
  try{
    const dir=join(f.root,"stage");
    stageBundle(f.request,{output:dir,executor:f.executor});
    const bundle=validateBundle(dir,f.request);
    const result=await publishSourceRelease(f.request,{
      dir,git:f.executor,token:"rehearsal-only",
      fetcher:async()=>++calls===1 ? new Response(null,{status:404}):
        new Response(JSON.stringify(remote(f.request,bundle)),{status:200}),
      runGh:(program,args)=>{
        assert.equal(program,"gh");
        assert.ok(args.includes("--verify-tag"));
        assert.ok(args.includes("--target"));
        assert.ok(args.includes(f.request.commit));
        creates++;
        return Buffer.from("");
      }
    });
    assert.equal(result.state,"published_verified");
    assert.equal(creates,1);
    assert.equal(calls,2);
    const replay=await publishSourceRelease(f.request,{
      dir,git:f.executor,token:"rehearsal-only",
      fetcher:async()=>new Response(JSON.stringify(remote(f.request,bundle)),{status:200}),
      runGh:()=>{throw Error("unexpected mutation on replay");}
    });
    assert.equal(replay.state,"existing_verified");
  }finally{f.cleanup();}
});
test("PER-1220 invalid API and version evidence never initiate GitHub publication",async()=>{
  const f=newFixture();let mutations=0;
  try{
    const dir=join(f.root,"stage");
    stageBundle(f.request,{output:dir,executor:f.executor});
    for(const status of [401,403,429,500,503]) {
      await assert.rejects(publishSourceRelease(f.request,{
        dir,git:f.executor,token:"rehearsal-only",
        fetcher:async()=>new Response(null,{status}),
        runGh:()=>{mutations++;}
      }),/lookup_failed/);
    }
    assert.equal(mutations,0);
    assert.throws(()=>validatePublishRequest({
      version:VERSION,commit:f.request.commit,mainCommit:"c".repeat(40),
      confirmation:"PUBLISH "+VERSION,enabled:"true",ref:"refs/heads/main",
      repository:f.request.repository,runId:f.request.runId
    }),/requested_commit_not_workflow_head/);
  }finally{f.cleanup();}
});
