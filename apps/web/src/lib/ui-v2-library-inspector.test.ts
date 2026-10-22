import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(path:string)=>readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
const library=read("../components/savant/screens/library-v2.tsx");
const publicLibrary=read("../components/savant/screens/skill-hub.tsx");
test("PER-1616 Library inspect summary shows actual skill purpose and evidence, not invented fields",()=>{
 for(const label of ["Purpose","Owner / team","Channel","State","Repository",
  "Provider","Indexed path","Source revision","Recorded quality","Recorded versions",
  "Access group","Latest recorded evaluation"]){
  assert.ok(library.includes(label),label);
 }
 assert.match(library,/activeSelection\.description/);
 assert.match(library,/detailState\.data\.evaluations/);
 assert.match(library,/result\.passed/);
 assert.match(library,/not proof of a current provider-backed execution/);
 assert.doesNotMatch(library,/mockSkill|fakeRun|sampleDependency|localStorage|sessionStorage/);
});
test("PER-1616 Public Library is discoverable but imports remain governed Git proposals",()=>{
 assert.match(library,/Browse Public Library/);
 assert.match(library,/Public Library/);
 assert.match(library,/marketplaceHref/);
 assert.ok(existsSync(fileURLToPath(new URL("../app/o/[workspaceSlug]/catalog/page.tsx",import.meta.url))));
 assert.match(publicLibrary,/importCatalogSkill/);
 assert.match(publicLibrary,/Propose import/);
 assert.match(publicLibrary,/SkillProposalNotice/);
 assert.match(publicLibrary,/repositoryId/);
 assert.doesNotMatch(library,/importCatalogSkill/);
});
test("PER-1616 dependency inspector can only display selected tenant ACL-backed Git file evidence",()=>{
 assert.match(library,/fetchSkillAssets\(selectedId,\{workspaceSlug:scope,signal:controller\.signal\}\)/);
 assert.match(library,/AbortController/);
 assert.match(library,/assetInventory\.scope!==scope/);
 assert.match(library,/assetInventory\.id!==selectedId/);
 assert.match(library,/assetInventory\.data\.files/);
 assert.match(library,/assetInventory\.data\.links/);
 assert.match(library,/Authored Git references are not observed tool calls/);
});
