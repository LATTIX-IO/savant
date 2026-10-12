import {TestBenchError} from "./definition-contract.ts";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** No client-selected provider, model, repository or source override accepted. */
export function parseObservedRunAdmission(value:unknown):{
  requestId:string;expectedRevision:number
}{
  if(!value||typeof value!=="object"||Array.isArray(value))
    throw new TestBenchError("test_bench_run_request_invalid",422);
  const row=value as Record<string,unknown>;
  if(Object.keys(row).length!==2||
    Object.keys(row).some(key=>key!=="requestId"&&key!=="expectedRevision")||
    typeof row.requestId!=="string"||!UUID.test(row.requestId)||
    !Number.isSafeInteger(row.expectedRevision)||(row.expectedRevision as number)<1)
    throw new TestBenchError("test_bench_run_request_invalid",422);
  return {requestId:row.requestId,expectedRevision:row.expectedRevision as number};
}
