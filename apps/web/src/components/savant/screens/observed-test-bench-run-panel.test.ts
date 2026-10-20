import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import test from "node:test";

test("PER-1425: observed case UI never falls back to browser-created scores",async()=>{
 const panel=await readFile(new URL("./observed-test-bench-run-panel.tsx",import.meta.url),"utf8");
 const editor=await readFile(new URL("./persisted-test-bench.tsx",import.meta.url),"utf8");
 assert.match(panel,/startObservedTestBenchRun\(/);
 assert.match(panel,/cancelObservedTestBenchRun\(/);
 assert.match(panel,/Cancel run/);
 assert.match(panel,/status==="canceled"/);
 assert.match(panel,/listObservedTestBenchRuns\(/);
 assert.match(panel,/status==="complete"/);
 assert.match(panel,/does not execute MCP tools, scripts or customer-owned harnesses/i);
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

test("PER-1429: cancellation route requires Origin, active tenant, role and bounded revision",async()=>{
 const route=await readFile(new URL("../../../app/api/skills/[id]/test-bench/[definitionId]/runs/[runId]/cancel/route.ts",import.meta.url),"utf8");
 const store=await readFile(new URL("../../../server/test-bench/observed-run-store.ts",import.meta.url),"utf8");
 const worker=await readFile(new URL("../../../server/test-bench/observed-run-worker.ts",import.meta.url),"utf8");
 assert.match(route,/assertSameOriginMutationRequest\(request\)/);
 assert.match(route,/authorizeTenantRequest\(request\)/);
 assert.match(route,/resolveGitActorForTenant\(tenant\)/);
 assert.match(route,/readBoundedTestBenchBody\(request\)/);
 assert.match(route,/parseObservedCancelRequest/);
 assert.match(route,/Cache-Control.*no-store/);
 assert.match(store,/actorAllowed\(actor,true\)/);
 assert.match(store,/test_bench_run_canceled/);
 assert.match(store,/for update/);
 assert.match(store,/status='canceled'/);
 assert.match(worker,/beforeCase:ensureNotCanceled/);
 assert.match(worker,/beforeJudge:ensureNotCanceled/);
 assert.doesNotMatch(route,/NVIDIA_NIM_API_KEY|JEV_API_KEY|process\.env/);
});

test("PER-1438: Test Bench provider choices and normalized-cost disclosure are explicit",async()=>{
 const panel=await readFile(new URL("./observed-test-bench-run-panel.tsx",import.meta.url),"utf8");
 const worker=await readFile(new URL("../../../server/test-bench/observed-run-worker.ts",import.meta.url),"utf8");
 assert.match(panel,/Workspace default OpenAI \(tenant key\)/);
 assert.match(panel,/Savant NVIDIA NIM \(platform key\)/);
 assert.match(panel,/executionSource/);
 assert.match(panel,/actual\s+provider charges are not capped/);
 assert.match(panel,/normalized QA cost proxy/);
 assert.match(worker,/createPinnedTenantOpenAiClient/);
 assert.match(worker,/if\(row.execution_source==="workspace-openai"\)/);
 assert.match(worker,/assertTenantOpenAiCanContinue/);
 assert.doesNotMatch(worker,/fallbackToNim|fallbackToPlatform|process\.env\.OPENAI_API_KEY/);
});
