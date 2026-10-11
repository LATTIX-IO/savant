import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateReleaseTrigger,validateReleaseVersion,getRootPackageVersion} from "./release-guard.mjs";
test("PER-1206: only matching explicit release tags or default-branch dispatch are eligible",()=>{
  assert.equal(validateReleaseTrigger({eventName:"push",ref:"refs/tags/v0.1.0",packageVersion:"0.1.0"}),"v0.1.0");
  assert.equal(validateReleaseTrigger({eventName:"workflow_dispatch",ref:"refs/heads/main",inputVersion:"v0.1.0",packageVersion:"0.1.0"}),"v0.1.0");
  for(const input of [
    {eventName:"workflow_run",ref:"refs/heads/main",packageVersion:"0.1.0"},
    {eventName:"push",ref:"refs/heads/main",packageVersion:"0.1.0"},
    {eventName:"workflow_dispatch",ref:"refs/heads/feature",inputVersion:"v0.1.0",packageVersion:"0.1.0"},
    {eventName:"workflow_dispatch",ref:"refs/heads/main",inputVersion:"v9.0.0",packageVersion:"0.1.0"},
  ])assert.throws(()=>validateReleaseTrigger(input),/implicit_release_disallowed|release_tag_required|default_branch|mismatch/);
});
test("PER-1206: reject unsafe version strings, malformed values and mismatches",()=>{
 for(const version of ["v1.2.3;touch /tmp/evil","v01.2.3","v1.2.3\nattack","v1.2.3+build","v1.2.3-","v1.2.4"]) {
   assert.throws(()=>validateReleaseVersion(version,"1.2.3"));
 }
 assert.equal(validateReleaseVersion("v1.2.3-rc.1","1.2.3-rc.1"),"v1.2.3-rc.1");
});
test("PER-1206: guard validates actual monorepo package and prevents inherited release trigger",()=>{
 assert.equal(getRootPackageVersion(),"0.1.0");
 const yaml=readFileSync(".github/workflows/release.yml","utf8");
 assert.doesNotMatch(yaml,/^\s*workflow_run:/m);
 assert.doesNotMatch(yaml,/\bcargo\s+(test|tauri|install|audit|deny)/);
 assert.doesNotMatch(yaml,/Cargo\\.toml|tauri-ui|mesh-node/);
 assert.match(yaml,/permissions:\s*\n\s*contents: read/);
 assert.match(yaml,/node scripts\/release-verify\.mjs/);
 assert.doesNotMatch(yaml,/\bcreate-release\b|softprops\/action-gh-release/);
});
