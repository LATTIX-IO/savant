import {TestBenchError} from "./definition-contract.ts";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Only existing immutable run IDs may be compared; no caller-supplied source,
 * model, tenant, per-case outcomes, thresholds or scoring weights.
 */
export function parseObservedComparisonRequest(input:unknown):{
  baselineRunId:string;candidateRunId:string;
}{
  if(!input||typeof input!=="object"||Array.isArray(input))
    throw new TestBenchError("test_bench_comparison_request_invalid",422);
  const row=input as Record<string,unknown>;
  if(Object.keys(row).length!==2||
    Object.keys(row).some(k=>k!=="baselineRunId"&&k!=="candidateRunId")||
    typeof row.baselineRunId!=="string"||!UUID.test(row.baselineRunId)||
    typeof row.candidateRunId!=="string"||!UUID.test(row.candidateRunId)||
    row.baselineRunId.toLowerCase()===row.candidateRunId.toLowerCase())
    throw new TestBenchError("test_bench_comparison_request_invalid",422);
  return {
    baselineRunId:row.baselineRunId.toLowerCase(),
    candidateRunId:row.candidateRunId.toLowerCase(),
  };
}
