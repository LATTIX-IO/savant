import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("PER-1435: Test Bench UI exposes observed descriptive comparison without synthetic scores",async()=>{
 const parent=await readFile(new URL("./persisted-test-bench.tsx",import.meta.url),"utf8");
 const panel=await readFile(new URL("./observed-run-comparison-panel.tsx",import.meta.url),"utf8");
 assert.match(parent,/<ObservedRunComparisonPanel skillId=\{skillId\} workspaceSlug=\{slug\}/);
 assert.match(panel,/listComparableObservedRuns\(/);
 assert.match(panel,/compareCompletedObservedRuns\(/);
 assert.match(panel,/sourceCommitSha!==selectedCandidate\.sourceCommitSha/);
 assert.match(panel,/not statistically significant/i);
 assert.match(panel,/never auto-approve a release/i);
 assert.doesNotMatch(panel,/simulateCustomEvaluationTest|Math\.random|syntheticResult|setPassRate|autoPromot/i);
});
test("PER-1435: comparison is workspace-authenticated, same-origin and never enqueues execution",async()=>{
 const route=await readFile(new URL("../../../app/api/skills/[id]/test-bench/compare/route.ts",import.meta.url),"utf8");
 const store=await readFile(new URL("../../../server/test-bench/observed-run-comparison-store.ts",import.meta.url),"utf8");
 const worker=await readFile(new URL("../../../server/test-bench/observed-run-store.ts",import.meta.url),"utf8");
 assert.equal((route.match(/authorizeTenantRequest\(request\)/g)??[]).length,2);
 assert.equal((route.match(/resolveGitActorForTenant\(tenant\)/g)??[]).length,2);
 assert.match(route,/assertSameOriginMutationRequest\(request\)/);
 assert.match(route,/parseObservedComparisonRequest\(await readBoundedTestBenchBody\(request\)\)/);
 assert.match(route,/Cache-Control.*no-store/);
 assert.match(store,/where organization_id=\$\{actor\.organizationId\} and skill_id=\$\{skillId\}/);
 assert.match(worker,/scoringContract:OBSERVED_SCORING_FINGERPRINT/);
 assert.doesNotMatch(route,/queue\.enqueue|kickBackgroundJobs|createNimChatClient|createJevClient|NVIDIA_NIM_API_KEY/);
});
