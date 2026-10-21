import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ObservedRunSummary } from "../server/test-bench/observed-run-store.ts";
import { selectObservedRuns,runEvidenceStatus } from "./ui-v2-runs-model.ts";

test("a missing provider receipt cannot become settled cost or a fabricated step trace",()=>{
 const run={id:"123",status:"complete",scorecard:{overallScore:87},observedUsageReceipts:0,
 estimatedCostUsd:.021,samples:[{caseId:"c1",verdict:"fail"},{caseId:"c2",verdict:"investigate"}],
 executionSource:"workspace-openai"} as unknown as ObservedRunSummary;
 assert.deepEqual(runEvidenceStatus(run),{
  failures:1,investigations:1,score:87,cost:null,providerSpendVerified:false,hasStepSpans:false,
 });
 assert.equal(runEvidenceStatus({...run,observedUsageReceipts:2}).cost,.021);
 assert.equal(runEvidenceStatus({...run,status:"running"}).score,null);
});
test("run list uses only suite-scoped persisted records",()=>{
 const runs=[{id:"run-a",status:"running",executionSource:"workspace-openai"},
 {id:"run-b",status:"complete",executionSource:"platform-nim"}] as unknown as ObservedRunSummary[];
 assert.deepEqual(selectObservedRuns(runs,"","active").map(r=>r.id),["run-a"]);
 assert.deepEqual(selectObservedRuns(runs,"nim","all").map(r=>r.id),["run-b"]);
 assert.deepEqual(selectObservedRuns(runs,"","failed"),[]);
});
test("Runs route remains server tenant-authenticated and client fetches use validated workspace scope",()=>{
 const route=readFileSync(fileURLToPath(new URL("../app/o/[workspaceSlug]/runs/page.tsx",import.meta.url)),"utf8");
 const layout=readFileSync(fileURLToPath(new URL("../app/o/[workspaceSlug]/layout.tsx",import.meta.url)),"utf8");
 const ui=readFileSync(fileURLToPath(new URL("../components/savant/screens/runs-v2.tsx",import.meta.url)),"utf8");
 assert.match(route,/RunsV2/);
 assert.ok(layout.indexOf("await resolveTenantMembershipForUser(")<
   layout.indexOf("const useV2 = isUiV2EnabledForWorkspace("));
 for(const method of ["fetchSkillList","listPersistedTestBenches","listObservedTestBenchRuns"])
   assert.ok(ui.includes(method),method);
 assert.match(ui,/workspaceSlug:slug,signal:controller.signal/);
 assert.match(ui,/hasStepSpans/);
 assert.match(ui,/provider invoice/);
 assert.doesNotMatch(ui,/localStorage|sessionStorage|dangerouslySetInnerHTML|Math\.random|eval\(/);
});
