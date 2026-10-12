import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("PER-1425: observed case UI never falls back to browser-created scores",async()=>{
 const panel=await readFile(new URL("./observed-test-bench-run-panel.tsx",import.meta.url),"utf8");
 const editor=await readFile(new URL("./persisted-test-bench.tsx",import.meta.url),"utf8");
 assert.match(panel,/startObservedTestBenchRun\(/);
 assert.match(panel,/listObservedTestBenchRuns\(/);
 assert.match(panel,/status==="complete"/);
 assert.match(panel,/not.*harness.*tool/i);
 assert.doesNotMatch(panel,/simulateCustomEvaluationTest|Math\.random|passRate\s*=|fakeScore|setCustomResult/);
 assert.match(editor,/<ObservedTestBenchRunPanel/);
 assert.match(editor,/workspaceSlug=\{slug\}/);
});
test("PER-1425: authorization and anti-CSRF precede provider job creation",async()=>{
 const post=await readFile(new URL("../../../app/api/skills/[id]/test-bench/[definitionId]/runs/route.ts",import.meta.url),"utf8");
 const details=await readFile(new URL("../../../app/api/skills/[id]/test-bench/[definitionId]/runs/[runId]/route.ts",import.meta.url),"utf8");
 const queue=await readFile(new URL("../../../server/jobs/runner.ts",import.meta.url),"utf8");
 const store=await readFile(new URL("../../../server/test-bench/observed-run-store.ts",import.meta.url),"utf8");
 assert.match(post,/assertSameOriginMutationRequest\(request\)/);
 assert.match(post,/authorizeTenantRequest\(request\)/);
 assert.match(post,/resolveGitActorForTenant\(tenant\)/);
 assert.match(post,/readAiServiceConfig\(\)/);
 assert.match(post,/parseObservedRunAdmission\(await readBoundedTestBenchBody\(request\)\)/);
 assert.match(details,/authorizeTenantRequest\(request\)/);
 assert.match(post,/Cache-Control.*no-store/);
 assert.match(details,/Cache-Control.*no-store/);
 assert.match(queue,/runObservedTestBenchJob\(ctx, job\)/);
 assert.match(store,/snapshot_ciphertext/);
 assert.match(store,/job_id/);
 assert.match(store,/tx\.json\(\{runId:id\}\)/);
 assert.doesNotMatch(store,/console\.log|raw_provider_error|sk_[A-Za-z0-9]{8,}/);
});
