import assert from "node:assert/strict";
import test from "node:test";
import {
  DAILY_OBSERVED_RUN_LIMIT,DAILY_NORMALIZED_TOKEN_LIMIT,
  NORMALIZED_UNITS_PER_RUN,publicAdmissionQuota,
} from "./observed-admission-quota.ts";
import {MAX_OBSERVED_TOKENS} from "./observed-evaluator.ts";
import {TestBenchError} from "./definition-contract.ts";

test("PER-1444: normalized daily quota is 10 admissions of one unchanged run token budget",()=>{
  assert.equal(DAILY_OBSERVED_RUN_LIMIT,10);
  assert.equal(NORMALIZED_UNITS_PER_RUN,MAX_OBSERVED_TOKENS);
  assert.equal(NORMALIZED_UNITS_PER_RUN,12000);
  assert.equal(DAILY_NORMALIZED_TOKEN_LIMIT,DAILY_OBSERVED_RUN_LIMIT*NORMALIZED_UNITS_PER_RUN);
});
test("PER-1444: present bounded UTC admissions, nonrefundable tokens and reset provenance",()=>{
  const utcDay="2026-10-13";
  const resetAtUtc="2026-10-14T00:00:00.000Z";
  const value=publicAdmissionQuota({
    utc_day:utcDay,reset_at_utc:resetAtUtc,
    admitted_runs:9,reserved_normalized_tokens:108000,
  });
  assert.deepEqual({
    day:value.utcDay,remaining:value.remainingRuns,
    accepted:value.admittedRuns,reset:value.resetAtUtc,
    tokens:value.remainingNormalizedTokens,refundable:value.releasesOnCancel,
    accounting:value.accounting,
  },{
    day:utcDay,remaining:1,accepted:9,reset:resetAtUtc,tokens:12000,
    refundable:false,accounting:"normalized-admission-reservation",
  });
  assert.equal(Date.parse(value.resetAtUtc)-Date.parse(value.utcDay+"T00:00:00.000Z"),86400000);
  assert.deepEqual(publicAdmissionQuota({
    utc_day:utcDay,reset_at_utc:resetAtUtc,
    admitted_runs:10,reserved_normalized_tokens:120000,
  }).remainingRuns,0);
});
test("PER-1444: reject malformed, over-limit, negative or inconsistent quota database records",()=>{
  const valid={utc_day:"2026-10-13",reset_at_utc:"2026-10-14T00:00:00.000Z",
    admitted_runs:1,reserved_normalized_tokens:12000};
  for(const forged of [
    {...valid,utc_day:"2026-10-13T15:00Z"},
    {...valid,reset_at_utc:"local midnight"},
    {...valid,admitted_runs:-1},
    {...valid,admitted_runs:11,reserved_normalized_tokens:132000},
    {...valid,admitted_runs:0},
    {...valid,admitted_runs:1,reserved_normalized_tokens:0},
    {...valid,admitted_runs:1,reserved_normalized_tokens:12001},
    {...valid,admitted_runs:1.5,reserved_normalized_tokens:18000},
  ])
    assert.throws(()=>publicAdmissionQuota(forged),
      error=>error instanceof TestBenchError&&error.code==="test_bench_quota_integrity_invalid");
});
