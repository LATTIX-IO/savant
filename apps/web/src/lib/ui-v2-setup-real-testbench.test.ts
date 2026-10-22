import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import type {TestBenchDefinition} from "../server/test-bench/definition-contract.ts";
import type {ObservedRunSummary} from "../server/test-bench/observed-run-store.ts";
import {describeWorkspaceSetup,selectedTestBenchReadiness} from "./ui-v2-setup-status.ts";
const suite={id:"suite-a",skillId:"skill-a",revision:3,sourceCommitSha:"a".repeat(40),
 cases:[{caseId:"case-1",kind:"positive",prompt:"x",expectedBehavior:"y",context:null}],
} as unknown as TestBenchDefinition;
const run={id:"run-1",definitionId:suite.id,skillId:suite.skillId,
 definitionRevision:suite.revision,sourceCommitSha:suite.sourceCommitSha,
 status:"complete",expectedCases:1,completedCases:1,samples:[{caseId:"case-1"}],
 observedUsageReceipts:2,observedExecutorTokens:10,observedJudgeTokens:5,
 executionModel:"test-executor",judgeModel:"test-judge",scorecard:{overallScore:91},
 unconfirmedProviderCalls:0,completedAt:"2026-10-22T10:00:00Z",
} as unknown as ObservedRunSummary;
const check=(definitions:TestBenchDefinition[]|null,runs:ObservedRunSummary[]|null)=>
 selectedTestBenchReadiness({selectedSkill:true,definitions,selectedSuite:definitions?.[0]??null,runs});
test("PER-1619 no selected skill, API denial or no suite never gives a false PASS",()=>{
 assert.deepEqual(selectedTestBenchReadiness({selectedSkill:false,definitions:[suite],selectedSuite:suite,runs:[run]}),
  {cases:"not-verified",verifiedRun:"not-verified"});
 assert.deepEqual(check(null,[run]),{cases:"unknown",verifiedRun:"unknown"});
 assert.deepEqual(check([],[]),{cases:"action-required",verifiedRun:"not-verified"});
 assert.deepEqual(check([suite],null),{cases:"observed",verifiedRun:"unknown"});
 assert.deepEqual(check([suite],[]),{cases:"observed",verifiedRun:"action-required"});
});
test("PER-1619 only exact-revision, provider-observed, fully completed case receipts count",()=>{
 assert.deepEqual(check([suite],[run]),{cases:"observed",verifiedRun:"observed"});
 for(const drift of [
  {definitionRevision:2},{sourceCommitSha:"b".repeat(40)},{skillId:"other"},
  {definitionId:"other"},{status:"running"},{status:"canceled"},
  {status:"failed"},{observedUsageReceipts:0},{unconfirmedProviderCalls:1},
  {observedExecutorTokens:0,observedJudgeTokens:0},{completedCases:0},
  {expectedCases:2},{samples:[]},{samples:[{caseId:"foreign"}]},
  {executionModel:null},{judgeModel:null},{scorecard:null},{completedAt:null},
 ]){
  assert.equal(check([suite],[{...run,...drift} as ObservedRunSummary]).verifiedRun,"action-required",
   JSON.stringify(drift));
 }
});
test("PER-1619 provider readiness remains per selected suite, never invented from registry metadata",()=>{
 const blank=describeWorkspaceSetup({repositories:[],skills:[],models:[]});
 assert.deepEqual(blank.steps.slice(-2).map(x=>x.state),["not-verified","not-verified"]);
 const observed=describeWorkspaceSetup({repositories:[],skills:[],models:[],
  caseState:"observed",verifiedRunState:"observed"});
 assert.deepEqual(observed.steps.slice(-2).map(x=>x.state),["observed","observed"]);
 assert.equal(observed.observed,2);
});
test("PER-1619 client reads only explicitly selected tenant-authorized Test Bench evidence",()=>{
 const source=readFileSync(fileURLToPath(new URL("../components/savant/screens/workspace-setup-checklist-v2.tsx",import.meta.url)),"utf8");
 for(const marker of [
  "live.skills?.find(item=>item.id===selectedSkillId)",
  "listPersistedTestBenches(skill.id,{workspaceSlug:slug,signal:controller.signal})",
  "listObservedTestBenchRuns(skill.id,currentSuite.id,currentSuite.sourceCommitSha",
  "selectedTestBenchReadiness(","runState=runs.key===runKey?",
  "AbortController","Select a tenant-authorized indexed skill",
  "They do not certify every skill in the organization",
 ])assert.ok(source.includes(marker),marker);
 assert.doesNotMatch(source,/localStorage|sessionStorage|mockProvider|fakeRun|Math.random|dangerouslySetInnerHTML/);
});
