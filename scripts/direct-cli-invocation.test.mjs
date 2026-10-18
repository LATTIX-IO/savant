import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname,join,resolve} from "node:path";
import test from "node:test";
import {isDirectCliInvocation} from "./direct-cli-invocation.mjs";

const directory=dirname(fileURLToPath(import.meta.url));

test("PER-1455: Windows PowerShell direct entrypoint accepts native and slash paths",()=>{
  const canonical="E:\\personal\\savant\\scripts\\release-governance-bootstrap.mjs";
  assert.equal(isDirectCliInvocation(canonical,canonical,"win32"),true);
  assert.equal(isDirectCliInvocation(
    "e:/personal/savant/scripts/release-governance-bootstrap.mjs",canonical,"win32"),true);
  assert.equal(isDirectCliInvocation(
    "E:\\personal\\savant\\scripts\\release-controls-audit.mjs",canonical,"win32"),false);
  assert.equal(isDirectCliInvocation(canonical+".backup",canonical,"win32"),false);
  assert.equal(isDirectCliInvocation("",canonical,"win32"),false);
  assert.equal(isDirectCliInvocation(null,canonical,"win32"),false);
});

test("PER-1455: Unix entrypoint rejects unrelated or suffix-spoofed paths",()=>{
  const file=resolve(directory,"release-governance-bootstrap.mjs");
  assert.equal(isDirectCliInvocation(file,file,"linux"),true);
  assert.equal(isDirectCliInvocation(file+".fake",file,"linux"),false);
  assert.equal(isDirectCliInvocation(resolve(directory,"other.mjs"),file,"linux"),false);
});

/** Fail-closed smoke verifies each real CLI actually executes rather than
 * silently returning zero when user-supplied admin context is absent.
 * Empty env prevents any GitHub network calls or writes.
 */
for(const [name,args] of [
  ["release-governance-bootstrap.mjs",[]],
  ["release-governance-bootstrap.mjs",["--apply","--confirm=PROTECT-LATTIX-IO-savant"]],
  ["release-controls-audit.mjs",[]]
]){
  test("PER-1455: "+name+" "+(args.length?"apply":"audit/plan")+" refuses absent operator context with nonzero exit",()=>{
    const env={PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??""};
    const result=spawnSync(process.execPath,[join(directory,name),...args],{
      env,cwd:resolve(directory,".."),encoding:"utf8",timeout:10000
    });
    assert.equal(result.signal,null);
    assert.equal(result.status,1,"CLI must fail closed without admin variables");
    const output=(result.stdout||"")+(result.stderr||"");
    const report=JSON.parse((result.stdout||result.stderr).trim());
    assert.equal(report.ready,false);
    assert.ok(typeof report.code==="string"||Array.isArray(report.problems));
    assert.doesNotMatch(output,/token|secret|Authorization:\s*Bearer/i);
  });
}


test("PER-1455: native dry run emits a canonical plan with distinct fictitious actors",()=>{
  const env={
    PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",
    GITHUB_REPOSITORY:"LATTIX-IO/savant",
    SAVANT_RELEASE_OPERATOR_ID:"12345",SAVANT_RELEASE_REVIEWER_ID:"67890",
    SAVANT_RELEASE_REVIEWER_TYPE:"User"
  };
  const result=spawnSync(process.execPath,[join(directory,"release-governance-bootstrap.mjs")],{
    env,cwd:resolve(directory,".."),encoding:"utf8",timeout:10000
  });
  assert.equal(result.status,0);
  assert.equal(result.stderr.trim(),"");
  const plan=JSON.parse(result.stdout.trim());
  assert.equal(plan.schema,"savant.github-governance-bootstrap.v1");
  assert.equal(plan.publicationEnabled,false);
  assert.equal(plan.operations.length,5);
});

test("PER-1455: native apply and governance audit deny valid actors with absent tokens",()=>{
  const env={
    PATH:process.env.PATH??"",SystemRoot:process.env.SystemRoot??"",
    GITHUB_REPOSITORY:"LATTIX-IO/savant",
    SAVANT_RELEASE_OPERATOR_ID:"12345",SAVANT_RELEASE_REVIEWER_ID:"67890",
    SAVANT_RELEASE_REVIEWER_TYPE:"User"
  };
  const apply=spawnSync(process.execPath,[
    join(directory,"release-governance-bootstrap.mjs"),
    "--apply","--confirm=PROTECT-LATTIX-IO-savant"
  ],{env,cwd:resolve(directory,".."),encoding:"utf8",timeout:10000});
  assert.equal(apply.status,1);
  assert.deepEqual(JSON.parse(apply.stderr.trim()),{
    ready:false,code:"missing_admin_token"
  });
  assert.equal(apply.stdout.trim(),"");
  const audit=spawnSync(process.execPath,[
    join(directory,"release-controls-audit.mjs")
  ],{env,cwd:resolve(directory,".."),encoding:"utf8",timeout:10000});
  assert.equal(audit.status,1);
  const report=JSON.parse(audit.stdout.trim());
  assert.equal(report.ready,false);
  assert.ok(report.problems.includes("missing_read_token"));
});
