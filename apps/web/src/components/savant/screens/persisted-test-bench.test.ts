import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("PER-1422: workspace test bench UI uses durable auth APIs, never synthetic results",async()=>{
 const panel=await readFile(new URL("./persisted-test-bench.tsx",import.meta.url),"utf8");
 const page=await readFile(new URL("./evaluation-detail.tsx",import.meta.url),"utf8");
 assert.match(page,/<PersistedTestBench skillId=\{detail\.skill\.id\} readOnly=\{detail\.readOnly\} pathname=\{pathname\}/);
 assert.match(panel,/listPersistedTestBenches\(skillId,/);
 assert.match(panel,/createPersistedTestBench\(skillId,/);
 assert.match(panel,/updatePersistedTestBench\(skillId,/);
 assert.match(panel,/archivePersistedTestBench\(skillId,/);
 assert.doesNotMatch(panel,/simulateCustomEvaluationTest|setCustomResult|passRate|clientGeneratedScore/);
 assert.match(panel,/saving alone does not score or publish anything/i);
});
test("PER-1422: tenant and mutation-origin enforcement on all server CRUD",async()=>{
 const base=await readFile(new URL("../../../app/api/skills/[id]/test-bench/route.ts",import.meta.url),"utf8");
 const item=await readFile(new URL("../../../app/api/skills/[id]/test-bench/[definitionId]/route.ts",import.meta.url),"utf8");
 for(const code of [base,item]){
  assert.match(code,/authorizeTenantRequest\(request\)/);
  assert.match(code,/resolveGitActorForTenant\(context\)/);
  assert.match(code,/isDevelopmentFallback/);
  assert.match(code,/gitErrorResponse\(error\)/);
  assert.match(code,/Cache-Control.*no-store/);
 }
 assert.match(base,/assertSameOriginMutationRequest\(request\)/);
 assert.equal((item.match(/assertSameOriginMutationRequest\(request\)/g)??[]).length,2);
 assert.match(item,/parseTestBenchMutation/);
 assert.match(item,/parseTestBenchArchive/);
});
