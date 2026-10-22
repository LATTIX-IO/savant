import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const src=readFileSync(fileURLToPath(new URL("../components/savant/screens/workflow-studio-v2.tsx",import.meta.url)),"utf8");
test("PER-1620 indexed skill binding uses real scoped server reads and human selection",()=>{
 for(const marker of [
  "fetchSkillList(undefined,{workspaceSlug:slug,signal:controller.signal})",
  "skillInventory.scope===slug","s.repo.toLowerCase()===repo.name.toLowerCase()",
  "repoSkills.find(entry=>entry.id===skillId)",
  "createAuthoredWorkflowSkillBinding(item,repo.name)",
  "extensions:{...(selected.extensions??{}),savantSkill:binding}",
  "describeAuthoredWorkflowSkillBinding","sourceCommitSha","not runtime authorization",
 ])assert.ok(src.includes(marker),marker);
 assert.doesNotMatch(src,/mockSkill|fakeSkill|localStorage|sessionStorage|dangerouslySetInnerHTML|executeSkill/);
});
test("PER-1620 removing or changing a node type clears stale skill references",()=>{
 assert.match(src,/if\(!skillId\)\{/);
 assert.match(src,/delete extensions\.savantSkill/);
 assert.match(src,/if\(kind!=="skill"\)delete extensions\.savantSkill/);
 assert.match(src,/value=\{typeof authoredSkillRef/);
 assert.match(src,/disabled=\{!repo\|\|busy\|\|visibleSkills\.phase!=="ready"\}/);
});
