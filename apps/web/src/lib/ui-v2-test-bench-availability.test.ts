import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {listPersistedTestBenches,TestBenchClientError} from "./test-bench-client.ts";
import {classifyTestBenchAvailability} from "./ui-v2-test-bench-availability.ts";
import {evaluationLifecycle} from "./ui-v2-evaluations-model.ts";
import type {EvaluationDashboardPayload} from "@savant/types";

const fail=(status:number,code?:string)=>new TestBenchClientError("unavailable",{status,...(code?{code}:{})});
test("PER-1625 missing staged schema and managed keys produce actionable but non-secret diagnostics",()=>{
 const schema=classifyTestBenchAvailability(fail(503,"test_bench_schema_unavailable"));
 assert.equal(schema.kind,"schema-unavailable");
 assert.match(schema.explanation,/schema.*unavailable|schema-activation/i);
 const key=classifyTestBenchAvailability(fail(503,"test_bench_key_unconfigured"));
 assert.equal(key.kind,"key-unavailable");
 assert.match(key.explanation,/managed-key/);
 assert.equal(classifyTestBenchAvailability(fail(503,"test_bench_integrity_failure")).kind,"key-unavailable");
 assert.equal(classifyTestBenchAvailability(fail(503)).kind,"temporarily-unavailable");
 assert.equal(classifyTestBenchAvailability(fail(403)).kind,"access-denied");
 assert.equal(classifyTestBenchAvailability(fail(404)).kind,"not-found");
 for(const err of [fail(500),new Error("confidential internal provider diagnostics"),null]){
  const x=classifyTestBenchAvailability(err);
  assert.equal(x.kind,"unexpected");
  assert.doesNotMatch(JSON.stringify(x),/confidential internal|table name|raw SQL/i);
 }
});
test("PER-1625 browser preserves sanitized HTTP error code, not server messages",async()=>{
 const fetcher:typeof fetch=async()=>new Response(JSON.stringify({
  error:{code:"test_bench_schema_unavailable",message:"internal relation test_bench_definitions"},
 }),{status:503,headers:{"content-type":"application/json"}});
 await assert.rejects(()=>listPersistedTestBenches("skill-a",{
  workspaceSlug:"tenant-a",fetcher,
 }),error=>{
  assert.ok(error instanceof TestBenchClientError);
  assert.equal(error.status,503);
  assert.equal(error.code,"test_bench_schema_unavailable");
  assert.doesNotMatch(error.message,/internal relation|test_bench_definitions/);
  return true;
 });
 const bad:typeof fetch=async()=>new Response(JSON.stringify({
  error:{code:"<b>unsafe</b>",message:"internal secret"},
 }),{status:403});
 await assert.rejects(()=>listPersistedTestBenches("skill-a",{workspaceSlug:"tenant-a",fetcher:bad}),error=>{
  assert.ok(error instanceof TestBenchClientError);
  assert.equal(error.status,403);
  assert.equal(error.code,null);
  assert.doesNotMatch(error.message,/internal secret|unsafe/);
  return true;
 });
});
test("PER-1625 historical indexed evaluation activity does not disappear when saved suites are offline",()=>{
 const recorded={runs:[{id:"baseline",status:"complete-baseline"},{id:"pending",status:"running"}]} as EvaluationDashboardPayload;
 assert.deepEqual(evaluationLifecycle(recorded,null),{
  definitions:null,running:1,completed:1,
 });
 const main=readFileSync(fileURLToPath(new URL("../components/savant/screens/evaluations-v2.tsx",import.meta.url)),"utf8");
 const detail=readFileSync(fileURLToPath(new URL("../components/savant/screens/persisted-test-bench-cases-v2.tsx",import.meta.url)),"utf8");
 const notice=readFileSync(fileURLToPath(new URL("../components/savant/screens/test-bench-availability-notice.tsx",import.meta.url)),"utf8");
 for(const source of [main,detail]){
  assert.match(source,/TestBenchAvailabilityNotice/);
  assert.match(source,/onRetry=\{\(\)=>setReload/);
  assert.match(source,/workspaceSlug:slug/);
 }
 assert.match(main,/visibleEvaluationRuns/);
 assert.match(main,/Recent indexed results/);
 assert.match(main,/saved\.phase==="error"\?<TestBenchAvailabilityNotice/);
 assert.match(detail,/!inv\.loading&&!inv\.error/);
 assert.match(notice,/role="alert"/);
 assert.match(notice,/Open Settings → Setup/);
 assert.match(notice,/historical Git-indexed evaluation/i);
 assert.doesNotMatch(notice,/localStorage|sessionStorage|mock|fake|Math.random|dangerouslySetInnerHTML/);
});
