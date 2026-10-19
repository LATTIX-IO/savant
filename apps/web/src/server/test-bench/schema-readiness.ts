/** A 42P01 PostgreSQL error normally indicates a programming or deployment
 * defect. Only known Test Bench relations withheld by the staged-migration gate
 * can be translated into a safe, transient 503. All other failures remain 500.
 *
 * Pure/side-effect-free for regression testing; never pass SQL or driver error
 * strings through to clients or telemetry.
 */
const STAGED_TEST_BENCH_RELATIONS=new Set([
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
]);
const MISSING_RELATION=/^relation "(test_bench_[a-z0-9_]+)" does not exist$/;

/** Matches only SQLSTATE 42P01 for a specifically known staged relation. */
export function isStagedTestBenchSchemaMissing(error:unknown):boolean{
  if(error===null||typeof error!=="object"||Array.isArray(error))
    return false;
  const candidate=error as {code?:unknown;message?:unknown};
  if(candidate.code!=="42P01"||typeof candidate.message!=="string"||
    candidate.message.length>160)return false;
  const match=MISSING_RELATION.exec(candidate.message);
  return Boolean(match&&STAGED_TEST_BENCH_RELATIONS.has(match[1]!));
}
