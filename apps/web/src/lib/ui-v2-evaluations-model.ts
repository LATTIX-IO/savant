import type { EvaluationRunListItem, EvaluationDashboardPayload } from "@savant/types";
import type { TestBenchDefinition } from "../server/test-bench/definition-contract.ts";

/** Counts refer to actual displayed records, not total-tenant or 30d estimates. */
export function evaluationLifecycle(
  dashboard: EvaluationDashboardPayload | null, definitions: readonly TestBenchDefinition[] | null,
) {
  const running=(dashboard?.runs??[]).filter(run=>run.status==="running").length;
  const completed=(dashboard?.runs??[]).filter(run=>
    run.status==="complete"||run.status==="complete-baseline"||
    run.status==="complete-with-regressions").length;
  return {definitions:definitions?.length??null, running: dashboard?running:null,
    completed:dashboard?completed:null};
}
export function visibleEvaluationRuns(
  runs:readonly EvaluationRunListItem[], query:string, status:"all"|"running"|"completed"|"issues",
):EvaluationRunListItem[] {
  const q=query.trim().toLocaleLowerCase();
  return runs.filter(run=> {
    const matches = !q || run.skill.toLocaleLowerCase().includes(q) ||
      run.id.toLocaleLowerCase().includes(q) || run.dataset.toLocaleLowerCase().includes(q);
    const state = status==="all" ||
      (status==="running"&&run.status==="running") ||
      (status==="completed"&&(run.status==="complete"||run.status==="complete-baseline")) ||
      (status==="issues"&&(run.status==="failed"||run.status==="complete-with-regressions"));
    return matches && state;
  });
}
