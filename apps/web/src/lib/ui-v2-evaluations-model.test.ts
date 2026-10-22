import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import type { EvaluationDashboardPayload, EvaluationRunListItem } from "@savant/types";
import { evaluationLifecycle, visibleEvaluationRuns } from "./ui-v2-evaluations-model.ts";

test("lifecycle reports null when server evidence is absent, not fictitious zero",()=>{
  assert.deepEqual(evaluationLifecycle(null,null),{definitions:null,running:null,completed:null});
  assert.deepEqual(evaluationLifecycle({runs:[
    {id:"run1",status:"running"},{id:"run2",status:"complete"},
    {id:"run3",status:"complete-with-regressions"},{id:"run4",status:"failed"},
  ]} as EvaluationDashboardPayload,[]),{definitions:0,running:1,completed:2});
});
test("run filters operate only on observed dashboard records, never sample data",()=>{
  const runs=[
    {id:"run-A",skill:"Incident triage",dataset:"sev2",status:"running"},
    {id:"run-B",skill:"Contract reviewer",dataset:"legal",status:"complete"},
    {id:"run-C",skill:"Incident triage",dataset:"sev2",status:"complete-with-regressions"},
  ] as EvaluationRunListItem[];
  assert.deepEqual(visibleEvaluationRuns(runs,"incident","issues").map(x=>x.id),["run-C"]);
  assert.deepEqual(visibleEvaluationRuns(runs,"","completed").map(x=>x.id),["run-B"]);
  assert.deepEqual(visibleEvaluationRuns(runs,"NOPE","all"),[]);
});
test("v2 authoring composes existing encrypted server CRUD and role-gated source capability",()=>{
  const screen=readFileSync(fileURLToPath(new URL("../components/savant/screens/evaluations-v2.tsx",import.meta.url)),"utf8");
  assert.match(screen,/fetchSkillList/);
  assert.match(screen,/fetchSkillSource/);
  assert.match(screen,/listPersistedTestBenches/);
  assert.match(screen,/PersistedTestBench/);
  assert.match(screen,/workspaceSlug.*signal:controller.signal/);
  assert.match(screen,/indexed\.canSave/);
  assert.match(screen,/A workspace-wide reference dataset inventory/);
  assert.match(screen,/TestBenchAvailabilityNotice/);
  assert.match(screen,/Visible|visibleEvaluationRuns/);
  assert.doesNotMatch(screen,/localStorage|sessionStorage|Math\.random|dangerouslySetInnerHTML|execWorkflow/);
  const classic=readFileSync(fileURLToPath(new URL("../components/savant/screens/evaluations.tsx",import.meta.url)),"utf8");
  assert.match(classic,/v2\?<EvaluationsV2\/>:<ClassicEvaluationsScreen\/>/);
});
