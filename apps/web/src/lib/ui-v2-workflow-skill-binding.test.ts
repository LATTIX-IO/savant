import test from "node:test";
import assert from "node:assert/strict";
import type {SkillListItem} from "@savant/types";
import {createAuthoredWorkflowSkillBinding,describeAuthoredWorkflowSkillBinding}
 from "./ui-v2-workflow-skill-binding.ts";
const skill={id:"skill-1",skillUuid:"uuid-1",name:"Safety review",repo:"LATTIX-IO/lattix-skills",
 projection:{sourceCommitSha:"a".repeat(40),sourcePath:"tier2/safety/safety-review/SKILL.md",indexedAt:"2026-10-22"},
} as SkillListItem;
test("PER-1620 source-reference binds only actual matching Git index metadata",()=>{
 const result=createAuthoredWorkflowSkillBinding(skill,"lattix-io/lattix-skills");
 assert.deepEqual(result,{evidence:"indexed-git-metadata-only",skillId:"skill-1",
  skillUuid:"uuid-1",repository:skill.repo,
  sourcePath:skill.projection.sourcePath,sourceCommitSha:"a".repeat(40)});
 assert.equal(createAuthoredWorkflowSkillBinding(skill,"other-org/repo"),null);
 assert.equal(createAuthoredWorkflowSkillBinding({...skill,projection:{...skill.projection,sourcePath:null}},skill.repo),null);
 assert.equal(createAuthoredWorkflowSkillBinding({...skill,projection:{...skill.projection,sourceCommitSha:null}},skill.repo),null);
 for(const path of ["../secret","x/../secret","a//b","/tmp/file","x\\y","x/.git/config"]){
  assert.equal(createAuthoredWorkflowSkillBinding({...skill,projection:{...skill.projection,sourcePath:path}},skill.repo),null,path);
 }
});
test("PER-1620 revision drift and unavailable index are not presented as verified references",()=>{
 const ref=createAuthoredWorkflowSkillBinding(skill,skill.repo);
 assert.ok(ref);
 assert.equal(describeAuthoredWorkflowSkillBinding(ref,[skill],skill.repo),"matching-index");
 assert.equal(describeAuthoredWorkflowSkillBinding(ref,null,skill.repo),"index-unavailable");
 assert.equal(describeAuthoredWorkflowSkillBinding(ref,[],skill.repo),"not-listed");
 assert.equal(describeAuthoredWorkflowSkillBinding(ref,[{...skill,
  projection:{...skill.projection,sourceCommitSha:"b".repeat(40)}}],skill.repo),"index-drift");
 assert.equal(describeAuthoredWorkflowSkillBinding(null,[skill],skill.repo),"not-bound");
 assert.equal(describeAuthoredWorkflowSkillBinding({...ref,evidence:"runtime-executed"},[skill],skill.repo),"not-bound");
});
