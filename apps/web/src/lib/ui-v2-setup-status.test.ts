import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {AIConnectionSummary,RepositoryListItem,SkillListItem} from "@savant/types";
import {describeWorkspaceSetup} from "./ui-v2-setup-status.ts";

const repo={id:"r-1",name:"skills",status:"active",state:"ready",provider:"github",skills:7}
 as unknown as RepositoryListItem;
const skill={id:"skill-1",skillUuid:"skill-uuid",name:"QA"} as SkillListItem;
const model:AIConnectionSummary={
 aiConnectionUuid:"conn-1",provider:"openai",label:"Test only",
 defaultModel:"gpt-test",purpose:"quality",status:"active",
 lastUsed:"never",lastRotated:"never",secretStore:"managed",usageScope:"quality",
 supportsExecution:true,supportsJudging:false,isDefaultExecution:true,isDefaultJudge:false,
};
test("PER-1614 empty and unauthorized setup evidence never implies success",()=>{
 const v=describeWorkspaceSetup({repositories:null,skills:null,models:null});
 assert.deepEqual(v.steps.map(x=>x.state),["unknown","unknown","unknown","not-verified","not-verified"]);
 assert.equal(v.observed,0);
 assert.equal(v.required,5);
 assert.equal(v.completeness,"unavailable");
 const zero=describeWorkspaceSetup({repositories:[],skills:[],models:[]});
 assert.deepEqual(zero.steps.slice(0,3).map(x=>x.state),
  ["action-required","action-required","action-required"]);
 assert.equal(zero.observed,0);
});
test("PER-1614 one connected Git repo and AI provider metadata never proves a live run",()=>{
 const v=describeWorkspaceSetup({repositories:[repo],skills:[skill],models:[model]});
 assert.equal(v.steps[0]?.state,"observed");
 assert.equal(v.steps[2]?.state,"observed");
 assert.deepEqual(v.steps.slice(-2).map(x=>x.state),["not-verified","not-verified"]);
 assert.ok(v.observed<=3);
 assert.equal(v.completeness,"partial");
});
test("PER-1614 Settings is default hub; integrations setup first; no second Manage Settings top-level page",()=>{
 const rd=(s:string)=>readFileSync(fileURLToPath(new URL(s,import.meta.url)),"utf8");
 const settings=rd("../components/savant/screens/settings-v2.tsx");
 const integrations=rd("../components/savant/screens/integrations-v2.tsx");
 const checklist=rd("../components/savant/screens/workspace-setup-checklist-v2.tsx");
 assert.match(settings,/useState<Section>\("setup"\)/);
 assert.match(settings,/\["setup","Setup"\]/);
 assert.doesNotMatch(settings,/\["advanced","Manage settings"\]/);
 assert.match(settings,/WorkspaceSetupChecklistV2/);
 assert.match(settings,/aria-expanded=\{showEditor\}/);
 assert.match(settings,/existing server-side permissions|authorized server-side controls/i);
 assert.match(integrations,/useState<Section>\("setup"\)/);
 assert.match(integrations,/\["setup","source","models","clients","distribution","router"\]/);
 assert.match(integrations,/Settings is the canonical one-stop place/);
 assert.match(checklist,/fetchRepositoryList/);
 assert.match(checklist,/fetchSkillList/);
 assert.match(checklist,/fetchAIConnections/);
 assert.match(checklist,/AbortController/);
 assert.match(checklist,/describeWorkspaceSetup/);
 assert.doesNotMatch(checklist,/localStorage|sessionStorage|fakeConnection|mockProvider|dangerouslySetInnerHTML/);
});
