import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("MVP QA regression: evaluation screen never fabricates a completed Test Bench run",async()=>{
 const source=await readFile(new URL("./evaluation-detail.tsx",import.meta.url),"utf8");
 assert.doesNotMatch(source,/simulateCustomEvaluationTest|CustomTestResultSection/);
 assert.doesNotMatch(source,/onClick=\{runEditorDraft\}|runSavedTestBenchEval/);
 assert.match(source,/Saved Test Bench configurations are local drafts, not executed evaluations/);
 assert.match(source,/<LiveEvaluationAutomation skillId=\{detail\.skill\.id\} readOnly=\{detail\.readOnly\}/);
});
test("MVP QA regression: server-backed trigger uses existing tenant-authorized APIs only",async()=>{
 const panel=await readFile(new URL("./live-evaluation-automation.tsx",import.meta.url),"utf8");
 const client=await readFile(new URL("../../../lib/live-evaluation-automation.ts",import.meta.url),"utf8");
 const route=await readFile(new URL("../../../app/api/skills/[id]/automation/generate/route.ts",import.meta.url),"utf8");
 assert.match(panel,/startLiveEvalAutomation\(skillId\)/);
 assert.match(client,/credentials: "same-origin"/);
 assert.match(client,/method: "POST", mode: "same-origin"/);
 assert.match(route,/assertSameOriginMutationRequest\(request\)/);
 assert.match(route,/authorizeTenantRequest\(request\)/);
 assert.match(route,/resolveGitActorForTenant\(context\)/);
 assert.match(route,/startEvalGeneration\(actor,/);
});
