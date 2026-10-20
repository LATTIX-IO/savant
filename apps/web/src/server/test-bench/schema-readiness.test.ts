import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import {isStagedTestBenchSchemaMissing} from "./schema-readiness.ts";

const missing=(table:string)=>Object.assign(
  new Error(`relation "${table}" does not exist`),{code:"42P01"}
);

test("PER-1421: missing staged Test Bench definitions and comparison tables return readiness signal",()=>{
  for(const name of [
    "test_bench_definitions",
    "test_bench_runs",
    "test_bench_daily_admissions",
    "test_bench_provider_usage_receipts",
    "test_bench_platform_provider_daily_admissions",
    "test_bench_provider_call_intents",
    "test_bench_provider_rate_cards",
    "test_bench_provider_rate_entries",
    "test_bench_tenant_monetary_policies",
    "test_bench_tenant_monetary_days",
    "test_bench_tenant_monetary_months",
    "test_bench_billing_periods",
    "test_bench_billing_documents",
    "test_bench_billing_lines",
  ])assert.equal(isStagedTestBenchSchemaMissing(missing(name)),true,name);
});

test("PER-1421: other missing tables remain unhandled, preserving real production incidents",()=>{
  for(const name of [
    "organizations","repositories","ai_connection_secrets",
    "background_jobs","indexed_skills","users","test_bench_undefined",
    "test_bench_dropped_future_table","public.test_bench_runs",
  ])assert.equal(isStagedTestBenchSchemaMissing(missing(name)),false,name);
});

test("PER-1421: never confuse permission denied, schema syntax, constraint or connectivity errors",()=>{
  for(const code of ["42501","42601","23505","23503","08006","28P01","42P07",""]){
    assert.equal(isStagedTestBenchSchemaMissing(
      Object.assign(new Error('relation "test_bench_runs" does not exist'),{code})),false,code);
  }
  for(const value of [null,undefined,true,5,42,"42P01",[],{},{
    code:"42P01",message:null
  },{
    code:"42P01",message:'relation "test_bench_runs" does not exist; DROP TABLE users'
  },{
    code:"42P01",message:'relation "test_bench_runs" does not exist\nrelation "users" does not exist'
  },{
    code:42,message:'relation "test_bench_runs" does not exist'
  }])assert.equal(isStagedTestBenchSchemaMissing(value),false);
});

test("PER-1421: HTTP 503 handling is before generic error fallback and cannot leak SQL",()=>{
  const source=readFileSync(new URL("../git/route-helpers.ts",import.meta.url),"utf8");
  const start=source.indexOf('if (isStagedTestBenchSchemaMissing(error))');
  const unexpected=source.indexOf('logGitEvent("error", "unhandled_route_error"');
  assert.ok(start>0&&unexpected>start);
  const segment=source.slice(start,source.indexOf('if (error instanceof GitProviderError)',start));
  assert.match(segment,/test_bench_schema_unavailable/);
  assert.match(segment,/status: 503/);
  assert.match(segment,/Cache-Control": "no-store"/);
  assert.doesNotMatch(segment,/error\.message|JSON\.stringify\(error\)/);
  assert.doesNotMatch(segment,/return NextResponse\.json\(error/);
});
