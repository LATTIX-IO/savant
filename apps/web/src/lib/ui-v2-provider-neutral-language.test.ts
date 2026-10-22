import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
const files=[
 "../components/savant/screens/skill-hub.tsx",
 "../components/savant/screens/live-evaluation-automation.tsx",
 "../components/savant/screens/skill-automation-panel.tsx",
 "../components/savant/screens/skill-router.tsx",
 "../components/savant/screens/observed-test-bench-run-panel.tsx",
];
test("PER-1617 user copy uses provider-neutral evaluator and skill-router names",()=>{
 for(const path of files){
  const content=readFileSync(fileURLToPath(new URL(path,import.meta.url)),"utf8");
  const rendered=content.replace(/automation\.services\.jev/g,"service-code-placeholder");
  assert.doesNotMatch(rendered,/\bJev\b/i,path);
  assert.ok(/judge|evaluator|skill router|evaluation judge/i.test(rendered),path);
 }
});
test("PER-1617 service identity and payment metering remain unmodified",()=>{
 const automation=readFileSync(fileURLToPath(new URL(files[2]!,import.meta.url)),"utf8");
 assert.match(automation,/automation\.services\.jev/);
 const run=readFileSync(fileURLToPath(new URL(files[4]!,import.meta.url)),"utf8");
 assert.match(run,/listObservedTestBenchRuns|observedUsageReceipts/);
});
