import type {AIConnectionSummary} from "@savant/types";

/** PER-1605: evidence-bound read-only lane inspection. This does NOT select an
 * invocation provider and must never be used as a production-serving grant.
 * Persisted independent traffic profiles are a separate PER-1602 contract.
 */
export function inspectUiV2ProviderLanes(
  connections: readonly AIConnectionSummary[]|null,
):{
  workspaceOpenAiExecutor:AIConnectionSummary|null;
  defaultJudgeCount:number;
  productionServing:null;
  firstObservedTestBenchRun:"unverified";
}{
  const active=connections?.filter(c=>c.status==="active")??[];
  // Only tenant OpenAI is supported by the current BYO Test Bench worker.
  const workspaceOpenAiExecutor=active.find(c=>
    c.provider==="openai"&&c.supportsExecution&&c.isDefaultExecution)??null;
  return {
    workspaceOpenAiExecutor,
    // A metadata default is not wired to the platform JEV evaluator.
    defaultJudgeCount:active.filter(c=>c.supportsJudging&&c.isDefaultJudge).length,
    productionServing:null,
    // Neither imported evaluations nor metadata can prove real execution.
    firstObservedTestBenchRun:"unverified",
  };
}
