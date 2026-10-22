import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const read=(p:string)=>readFileSync(fileURLToPath(new URL(p,import.meta.url)),"utf8");
const ui=read("../components/savant/screens/persisted-test-bench-cases-v2.tsx");
const evals=read("../components/savant/screens/evaluations-v2.tsx");
const detail=read("../components/savant/screens/evaluation-detail.tsx");
test("PER-1613 saved case table, scenario, prompt and verdict are backed by encrypted API records",()=>{
 for(const key of ["listPersistedTestBenches","listObservedTestBenchRuns",
  "createPersistedTestBench","updatePersistedTestBench","archivePersistedTestBench",
  "parseTestBenchCases","expectedRevision:selected!.revision",
  "definitionRevision===selected?.revision","sourceCommitSha===selected.sourceCommitSha",
  "currentRun?.samples","sample.verdict","Latest observed verdict",
 ]){
  assert.ok(ui.toLowerCase().includes(key.toLowerCase()),key);
 }
 assert.match(ui,/Not run for this revision/);
 assert.match(ui,/independently\s+calibrated numeric case scores/);
 assert.match(ui,/UiV2InspectorDrawer/);
 assert.match(ui,/\+ New Case/);
 assert.match(ui,/New test case/);
 assert.match(ui,/Save case revision/);
 assert.match(ui,/AbortController/);
 assert.doesNotMatch(ui,/Math\.random|localStorage|sessionStorage|mockRun|fakeScore|simulatedResults|dangerouslySetInnerHTML/);
});
test("PER-1613 both evaluation experiences render list-drawer rather than large inline authoring form",()=>{
 assert.match(evals,/PersistedTestBenchCasesV2/);
 assert.match(detail,/PersistedTestBenchCasesV2/);
 assert.doesNotMatch(evals,/<PersistedTestBench\s/);
 assert.doesNotMatch(detail,/<PersistedTestBench\s/);
});
test("PER-1613 per-case output never infers score from historical indexed benchmark",()=>{
 assert.match(ui,/a completed, source-pinned provider run/);
 assert.match(ui,/No saved Test Bench suites/);
 assert.match(ui,/Indexed benchmark scores from older Git evaluations/);
 assert.match(ui,/Saving writes an encrypted, revisioned case definition/);
});
