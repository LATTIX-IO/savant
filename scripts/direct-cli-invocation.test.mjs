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
    assert.match(output,/"ready":false/);
    assert.doesNotMatch(output,/token|secret|Authorization:\s*Bearer/i);
  });
}
