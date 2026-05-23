import type { ReleaseQueueItem, SkillListItem } from "@savant/types";

import type {
  EvaluationCustomTestPreset,
  EvaluationDetailResponse,
  EvaluationFailureCluster,
  EvaluationHistoricalRun,
  EvaluationMetric,
  EvaluationMetricAlignment,
  EvaluationRecommendation,
  EvaluationRunDetail,
  EvaluationRunSummary,
} from "../../lib/evaluation-detail-helpers.ts";
import { createControlPlaneMeta } from "./control-plane-response.ts";
import { getControlPlaneDatabase } from "./database.ts";
import {
  buildEvaluationRunListItem,
  formatRelativeControlPlaneTime,
  readSkillsFromDatabase,
  resolveIndexedEvalDatasetLabel,
} from "./read-model-db.ts";
import type { TenantReadContext } from "./read-model-db.ts";

type EvaluationDetailRow = {
  result_id: string;
  run_external_id: string | null;
  dataset_asset_id: string | null;
  dataset_logical_name: string | null;
  dataset_source_path: string | null;
  baseline_source_path: string | null;
  comparison_artifact_path: string | null;
  comparison_commit_sha: string | null;
  total_cases: number;
  passed_cases: number;
  failed_cases: number;
  status: string;
  executed_at: Date | string | null;
  indexed_at: Date | string;
  score_delta: number | null;
  skill_id: string;
  skill_name: string;
  skill_tier: string;
};

type ReviewCommentRow = {
  author_name: string | null;
  body: string;
  created_at: Date | string;
};

type ActiveReleaseRow = {
  id: string;
  source_ref: string;
  source_commit_sha: string;
  from_environment: string;
  to_environment: string;
  created_at: Date | string;
  requested_by: string | null;
  approvals_done: number;
  approvals_required: number;
  approvals_blocked: string | null;
  targets: string[] | null;
};

type SkillVersionRow = {
  commit_sha: string;
  version_ref: string;
};

function roundScore(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function buildPassRate(run: EvaluationRunSummary): number {
  return roundScore((run.passed * 100) / Math.max(run.cases, 1)) ?? 0;
}

function buildFailureContainment(run: EvaluationRunSummary): number {
  return roundScore(100 - ((run.failed * 100) / Math.max(run.cases, 1))) ?? 0;
}

function buildDeltaIndex(run: EvaluationRunSummary): number {
  if (run.delta == null) {
    return 50;
  }

  return roundScore(clamp(50 + (run.delta * 10), 0, 100)) ?? 50;
}

function buildMetricStrip(
  run: EvaluationRunSummary,
  baselineRun: EvaluationRunSummary | null,
  release: ReleaseQueueItem | null,
): EvaluationMetric[] {
  const baselinePassRate = baselineRun ? buildPassRate(baselineRun) : buildPassRate(run);
  const baselineContainment = baselineRun ? buildFailureContainment(baselineRun) : buildFailureContainment(run);
  const baselineDeltaIndex = baselineRun ? buildDeltaIndex(baselineRun) : 50;
  const metrics: EvaluationMetric[] = [
    {
      id: "pass-rate",
      label: "Pass rate",
      baseline: baselinePassRate,
      candidate: buildPassRate(run),
      unit: "%",
      direction: "up",
      note: "Derived from indexed passed vs total case counts for this run.",
    },
    {
      id: "failure-containment",
      label: "Failure containment",
      baseline: baselineContainment,
      candidate: buildFailureContainment(run),
      unit: "%",
      direction: "up",
      note: "Higher is better; fewer failed cases in the indexed result improve this score.",
    },
    {
      id: "delta-index",
      label: "Baseline delta",
      baseline: baselineDeltaIndex,
      candidate: buildDeltaIndex(run),
      unit: "pts",
      direction: "up",
      note: "Centered score built from the indexed score delta when comparison data is available.",
    },
  ];

  if (release) {
    const readinessPct = release.readinessPct > 1 ? release.readinessPct : release.readinessPct * 100;
    metrics.push({
      id: "release-readiness",
      label: "Release readiness",
      baseline: 0,
      candidate: roundScore(clamp(readinessPct, 0, 100)) ?? 0,
      unit: "%",
      direction: "up",
      note: "Derived from the active release request tied to this evaluation candidate.",
    });
  }

  return metrics;
}

function severityForFailures(failed: number, cases: number): EvaluationFailureCluster["severity"] {
  const ratio = cases > 0 ? failed / cases : 0;

  if (ratio >= 0.15 || failed >= 10) {
    return "critical";
  }

  if (ratio >= 0.05 || failed >= 4) {
    return "moderate";
  }

  return "minor";
}

function buildFailureClusters(
  run: EvaluationRunSummary,
  datasetLabel: string,
  comparisonArtifactPath: string | null,
  baselineSourcePath: string | null,
  skill: SkillListItem,
): EvaluationFailureCluster[] {
  const clusters: EvaluationFailureCluster[] = [];

  if (run.failed > 0) {
    clusters.push({
      id: `${run.id}-cluster-failing-cases`,
      label: "Indexed failing cases",
      severity: severityForFailures(run.failed, run.cases),
      cases: run.failed,
      owner: skill.owner,
      summary: `${run.failed} indexed cases did not pass for ${datasetLabel}.`,
      suggestedUpdate: "Inspect the failing slice first, then turn those cases into a narrower Test Bench rerun before broad prompt changes.",
      examples: [comparisonArtifactPath, baselineSourcePath, datasetLabel].filter((value): value is string => Boolean(value)),
    });
  }

  if (run.delta != null && run.delta < 0) {
    clusters.push({
      id: `${run.id}-cluster-regression`,
      label: "Regression against comparison baseline",
      severity: run.delta <= -2 ? "critical" : "moderate",
      cases: Math.max(run.failed, 1),
      owner: skill.team,
      summary: `The indexed score delta dropped ${Math.abs(run.delta).toFixed(1)} points against the comparison baseline.`,
      suggestedUpdate: "Review the commit-specific changes that landed between the prior baseline and this candidate, then rerun the same slice before widening the benchmark.",
      examples: [comparisonArtifactPath ?? datasetLabel],
    });
  }

  if (run.status === "running") {
    clusters.push({
      id: `${run.id}-cluster-running`,
      label: "Execution still in progress",
      severity: "minor",
      cases: Math.max(run.failed, 0),
      owner: "control-plane index",
      summary: "This indexed run is still in progress, so recommendations are based on partial execution state.",
      suggestedUpdate: "Wait for the indexed run to settle before treating it as the canonical benchmark outcome.",
      examples: [datasetLabel],
    });
  }

  if (clusters.length === 0) {
    clusters.push({
      id: `${run.id}-cluster-stable`,
      label: "No blocking indexed cluster",
      severity: "minor",
      cases: 0,
      owner: skill.owner,
      summary: "The indexed run did not surface a blocking regression cluster, so use the recommendations below to harden the next iteration rather than to recover a live failure.",
      suggestedUpdate: "Promote the strongest slice into a standing benchmark and keep the next change narrowly scoped.",
      examples: [datasetLabel],
    });
  }

  return clusters;
}

function buildRecommendations(
  run: EvaluationRunSummary,
  skill: SkillListItem,
  datasetLabel: string,
  baselineRun: EvaluationRunSummary | null,
  failureClusters: EvaluationFailureCluster[],
): EvaluationRecommendation[] {
  const recommendations: EvaluationRecommendation[] = [];

  if (run.failed > 0) {
    recommendations.push({
      id: `${run.id}-rec-dataset`,
      category: "dataset",
      title: `Promote the failing ${datasetLabel} slice into a standing regression pack`,
      effort: run.failed >= 8 ? "medium" : "low",
      impact: `Turns ${run.failed} current failing case${run.failed === 1 ? "" : "s"} into a repeatable gate for the next candidate.`,
      rationale: `${failureClusters[0]?.summary ?? "The live index surfaced a concentrated failure slice."}`,
      actions: [
        `Pull the ${run.failed} failing cases from ${datasetLabel} into a dedicated Test Bench draft.`,
        "Save that slice as a repeatable regression check before broadening the benchmark again.",
        "Compare the rerun against the current baseline before queuing another release candidate.",
      ],
    });
  }

  if (run.delta != null && run.delta < 0) {
    recommendations.push({
      id: `${run.id}-rec-prompt`,
      category: "prompt",
      title: `Tighten the candidate behavior on ${skill.name}'s current regression path`,
      effort: Math.abs(run.delta) >= 2 ? "medium" : "low",
      impact: `Targets the ${Math.abs(run.delta).toFixed(1)}-point indexed drop before more work piles onto the candidate.`,
      rationale: "A negative indexed delta usually means the current candidate needs a narrower iteration before the next full-benchmark pass.",
      actions: [
        "Diff the candidate commit against the last stronger benchmark result.",
        "Apply the smallest prompt or logic change that addresses the top failing slice.",
        "Rerun the focused Test Bench slice before spending cycles on the full benchmark.",
      ],
    });
  }

  if (!baselineRun) {
    recommendations.push({
      id: `${run.id}-rec-rubric`,
      category: "rubric",
      title: "Establish a stable comparison baseline for future benchmark runs",
      effort: "medium",
      impact: "Makes future score deltas more trustworthy by anchoring the next reruns to a stable comparison point.",
      rationale: "This run does not yet have a prior indexed baseline attached to the same benchmark slice.",
      actions: [
        "Choose the best-known current run as the baseline reference for this dataset slice.",
        "Capture the metric semantics in the Test Bench editor before publishing benchmark artifacts.",
        "Re-index after publishing so future deltas point at the same benchmark contract.",
      ],
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      id: `${run.id}-rec-guardrail`,
      category: "guardrail",
      title: "Keep this passing slice small and deliberate",
      effort: "low",
      impact: "Preserves a good benchmark result without overfitting the next candidate iteration.",
      rationale: "The current indexed run is stable enough to shift from recovery work to guardrail maintenance.",
      actions: [
        "Pin this slice into the standing promotion suite.",
        "Prefer a focused follow-up benchmark over a broad full-suite rerun.",
        "Queue only the highest-confidence recommendation into the Builder tab.",
      ],
    });
  }

  return recommendations.slice(0, 3);
}

function buildMetricAlignment(
  skill: SkillListItem,
  datasetLabel: string,
  recommendations: EvaluationRecommendation[],
): EvaluationMetricAlignment[] {
  const promptRecommendation = recommendations.find((recommendation) => recommendation.category === "prompt")?.title
    ?? "tighten the next candidate iteration on the current failing slice";
  const datasetRecommendation = recommendations.find((recommendation) => recommendation.category === "dataset")?.title
    ?? "promote the weak cases into a repeatable regression pack";
  const guardrailRecommendation = recommendations.find((recommendation) => recommendation.category === "guardrail")?.title
    ?? "pin this benchmark as a standing release guardrail";
  const rubricRecommendation = recommendations.find((recommendation) => recommendation.category === "rubric")?.title
    ?? "clarify the metric semantics for the next baseline";

  return [
    {
      metricId: "quality",
      metricLabel: "Quality",
      weight: 0.3,
      whatToMeasure: `How accurately ${skill.name} handles the indexed ${datasetLabel} benchmark slice overall.`,
      howToGrade: [
        "Reward correct, decision-ready outcomes on the indexed benchmark cases.",
        "Penalize missing caveats, incorrect classifications, or incomplete reviewer guidance.",
      ],
      improvementLevers: [
        `Prompt lever: ${promptRecommendation}.`,
        `Dataset lever: ${datasetRecommendation}.`,
      ],
    },
    {
      metricId: "compliance",
      metricLabel: "Compliance",
      weight: 0.2,
      whatToMeasure: `Whether ${skill.name} stays inside the benchmark's required rules, policies, and formatting expectations.`,
      howToGrade: [
        "Reward outputs that satisfy the indexed benchmark constraints without manual cleanup.",
        "Apply strong penalties to policy misses, unsupported claims, or malformed outputs.",
      ],
      improvementLevers: [
        `Guardrail lever: ${guardrailRecommendation}.`,
        "Elevate policy-sensitive failures into blocking regression checks.",
      ],
    },
    {
      metricId: "grounding",
      metricLabel: "Grounding",
      weight: 0.15,
      whatToMeasure: `How well the output stays anchored to the benchmark evidence and indexed comparison artifacts for ${datasetLabel}.`,
      howToGrade: [
        "Reward source-backed reasoning and reviewer-visible evidence linkage.",
        "Penalize unsupported reasoning or claims that drift away from the indexed evidence.",
      ],
      improvementLevers: [
        `Rubric lever: ${rubricRecommendation}.`,
        "Capture any missing benchmark evidence as an explicit rerun check.",
      ],
    },
    {
      metricId: "actionability",
      metricLabel: "Actionability",
      weight: 0.2,
      whatToMeasure: `Whether reviewers can confidently act on ${skill.name}'s output without additional interpretation.`,
      howToGrade: [
        "Reward clear next steps, concise rationale, and obvious reviewer decisions.",
        "Downgrade vague guidance or outputs that still need extra reviewer translation.",
      ],
      improvementLevers: [
        `Prompt lever: ${promptRecommendation}.`,
        "Translate common reviewer edits into explicit benchmark expectations.",
      ],
    },
    {
      metricId: "efficiency",
      metricLabel: "Efficiency",
      weight: 0.15,
      whatToMeasure: `How efficiently ${skill.name} reaches acceptable quality on ${datasetLabel} without excess reruns or avoidable failures.`,
      howToGrade: [
        "Reward stable pass rates with low failure concentration.",
        "Downgrade iterations that require repeated reruns to recover the same benchmark slice.",
      ],
      improvementLevers: [
        `Dataset lever: ${datasetRecommendation}.`,
        "Trim the next rerun to the smallest slice that can prove the fix.",
      ],
    },
  ];
}

function buildCustomTestPresets(
  run: EvaluationRunSummary,
  datasetLabel: string,
): EvaluationCustomTestPreset[] {
  const focusedCaseCount = Math.max(12, Math.min(run.cases, 24));
  const hardModeCaseCount = Math.max(12, Math.min(run.cases, 16));
  const reviewCaseCount = Math.max(12, Math.min(run.cases, 20));

  return [
    {
      id: "focused-regression",
      label: "Focused rerun",
      focus: `Retest the current ${datasetLabel} regression slice on a narrow benchmark.`,
      datasetSlice: "focused-regression-slice",
      caseCount: focusedCaseCount,
      judgeModel: "balanced rubric judge",
      notes: "Prefer the most recent failing and borderline cases.",
    },
    {
      id: "hard-mode",
      label: "Hard mode",
      focus: `Stress-test ${datasetLabel} on edge-heavy cases before treating the next run as promotion-ready.`,
      datasetSlice: "hard-mode-edge-cases",
      caseCount: hardModeCaseCount,
      judgeModel: "strict rubric judge",
      notes: "Bias toward the riskiest cases from the indexed benchmark.",
    },
    {
      id: "reviewer-pass",
      label: "Reviewer confidence pass",
      focus: `Measure whether the next iteration improves reviewer trust on ${datasetLabel}.`,
      datasetSlice: "reviewer-confidence-pass",
      caseCount: reviewCaseCount,
      judgeModel: "balanced rubric judge",
      notes: "Track explanation quality and decision clarity alongside pass rate.",
    },
  ];
}

function buildReviewerNotes(
  run: EvaluationRunSummary,
  focus: string,
  failureClusters: EvaluationFailureCluster[],
  reviewComments: ReviewCommentRow[],
): Array<{ who: string; when: string; text: string }> {
  const indexedNote = {
    who: "control-plane index",
    when: run.started,
    text: run.failed > 0
      ? `Indexed run ${run.id} is concentrating on ${focus}, with ${failureClusters[0]?.cases ?? run.failed} case${(failureClusters[0]?.cases ?? run.failed) === 1 ? "" : "s"} needing follow-up.`
      : `Indexed run ${run.id} is currently stable on ${focus}; use the next rerun to keep the slice narrow and repeatable.`,
  };

  return [
    indexedNote,
    ...reviewComments.slice(0, 2).map((comment) => ({
      who: comment.author_name?.trim() || "Reviewer",
      when: formatRelativeControlPlaneTime(comment.created_at),
      text: comment.body,
    })),
  ];
}

function toEvaluationSummary(
  row: EvaluationDetailRow,
  versionRefsByCommit: ReadonlyMap<string, string>,
): EvaluationRunSummary {
  const dashboardRun = buildEvaluationRunListItem(row);
  const resolvedRef = row.comparison_commit_sha
    ? versionRefsByCommit.get(row.comparison_commit_sha) ?? dashboardRun.ref
    : dashboardRun.ref;

  return {
    id: dashboardRun.id,
    ref: resolvedRef,
    dataset: dashboardRun.dataset,
    cases: dashboardRun.cases,
    passed: dashboardRun.passed,
    failed: dashboardRun.failed,
    started: dashboardRun.started,
    duration: dashboardRun.duration,
    delta: dashboardRun.delta,
    status: dashboardRun.status,
  };
}

function buildHistoricalRuns(
  rows: EvaluationDetailRow[],
  versionRefsByCommit: ReadonlyMap<string, string>,
  skill: SkillListItem,
  publishedRef: string | null,
): EvaluationHistoricalRun[] {
  return rows.map((row) => {
    const run = toEvaluationSummary(row, versionRefsByCommit);
    const isCurrentCandidate = row.comparison_commit_sha != null
      && skill.candidateCommit !== "—"
      && row.comparison_commit_sha === skill.candidateCommit;
    const isCurrentPublished = row.comparison_commit_sha != null
      && skill.commit !== "—"
      && row.comparison_commit_sha === skill.commit;
    const readOnly = !isCurrentCandidate && !isCurrentPublished && publishedRef != null;

    return {
      uuid: run.id,
      ...run,
      score: buildPassRate(run),
      readOnly,
      newerPublishedRef: readOnly ? publishedRef : null,
    };
  });
}

function buildReleaseReadiness(
  run: EvaluationRunSummary,
  releaseRow: ActiveReleaseRow,
): ReleaseQueueItem["readiness"] {
  const evalPassing = run.status === "complete" || run.status === "complete-baseline";
  const approvalsSatisfied = releaseRow.approvals_required > 0
    ? releaseRow.approvals_done >= releaseRow.approvals_required
    : null;

  return [
    {
      label: "Eval suite passing",
      ok: evalPassing ? true : run.status === "failed" || run.status === "complete-with-regressions" ? false : null,
      meta: run.failed > 0 ? `${run.passed}/${run.cases} passed · ${run.failed} failed` : `${run.passed}/${run.cases} passed`,
    },
    {
      label: "Approvals",
      ok: approvalsSatisfied,
      meta: releaseRow.approvals_required > 0
        ? `${releaseRow.approvals_done}/${releaseRow.approvals_required} approvals${releaseRow.approvals_blocked ? ` · awaiting ${releaseRow.approvals_blocked}` : ""}`
        : "No approvers assigned yet",
    },
    {
      label: "Targets",
      ok: releaseRow.targets && releaseRow.targets.length > 0 ? true : null,
      meta: releaseRow.targets && releaseRow.targets.length > 0
        ? releaseRow.targets.join(", ")
        : "No release targets configured",
    },
  ];
}

function buildActiveRelease(
  run: EvaluationRunSummary,
  releaseRow: ActiveReleaseRow | null,
): ReleaseQueueItem | null {
  if (!releaseRow) {
    return null;
  }

  const readiness = buildReleaseReadiness(run, releaseRow);
  const passedCount = readiness.filter((item) => item.ok === true).length;
  const readinessPct = readiness.length > 0 ? passedCount / readiness.length : 0;

  return {
    id: releaseRow.id,
    skill: "",
    candidateRef: releaseRow.source_ref,
    candidateCommit: releaseRow.source_commit_sha,
    fromEnv: releaseRow.from_environment as ReleaseQueueItem["fromEnv"],
    toEnv: releaseRow.to_environment as ReleaseQueueItem["toEnv"],
    requested: releaseRow.requested_by ?? "System",
    when: formatRelativeControlPlaneTime(releaseRow.created_at),
    approvalsDone: releaseRow.approvals_done,
    approvalsRequired: releaseRow.approvals_required,
    approvalsBlocked: releaseRow.approvals_blocked,
    readinessPct,
    readiness,
    targets: releaseRow.targets ?? [],
  };
}

async function queryPrimaryEvaluationRow(
  organizationId: string,
  identifier: string,
): Promise<EvaluationDetailRow | null> {
  const sql = await getControlPlaneDatabase();
  const rows = await sql<EvaluationDetailRow[]>`
    with latest_skills as (
      select distinct on (indexed_skills.skill_id)
        indexed_skills.id as indexed_skill_id,
        indexed_skills.skill_id,
        indexed_skills.display_name,
        indexed_skills.tier
      from indexed_skills
      where indexed_skills.organization_id = ${organizationId}
      order by indexed_skills.skill_id, indexed_skills.last_indexed_at desc
    )
    select
      indexed_eval_results.id as result_id,
      indexed_eval_results.run_external_id,
      indexed_eval_results.dataset_asset_id,
      dataset_asset.logical_name as dataset_logical_name,
      dataset_asset.source_path as dataset_source_path,
      baseline_asset.source_path as baseline_source_path,
      indexed_eval_results.comparison_artifact_path,
      indexed_eval_results.comparison_commit_sha,
      indexed_eval_results.total_cases,
      indexed_eval_results.passed_cases,
      indexed_eval_results.failed_cases,
      indexed_eval_results.status,
      indexed_eval_results.executed_at,
      indexed_eval_results.indexed_at,
      indexed_eval_results.score_delta::float8 as score_delta,
      latest_skills.skill_id,
      latest_skills.display_name as skill_name,
      latest_skills.tier as skill_tier
    from indexed_eval_results
    inner join latest_skills on latest_skills.indexed_skill_id = indexed_eval_results.indexed_skill_id
    left join indexed_eval_assets dataset_asset
      on dataset_asset.id = indexed_eval_results.dataset_asset_id
    left join indexed_eval_assets baseline_asset
      on baseline_asset.id = indexed_eval_results.baseline_asset_id
    where indexed_eval_results.id::text = ${identifier}
      or indexed_eval_results.run_external_id = ${identifier}
    order by case when indexed_eval_results.id::text = ${identifier} then 0 else 1 end
    limit 1
  `;

  return rows[0] ?? null;
}

async function queryHistoricalEvaluationRows(
  organizationId: string,
  current: EvaluationDetailRow,
): Promise<EvaluationDetailRow[]> {
  const sql = await getControlPlaneDatabase();
  return sql<EvaluationDetailRow[]>`
    select
      indexed_eval_results.id as result_id,
      indexed_eval_results.run_external_id,
      indexed_eval_results.dataset_asset_id,
      dataset_asset.logical_name as dataset_logical_name,
      dataset_asset.source_path as dataset_source_path,
      baseline_asset.source_path as baseline_source_path,
      indexed_eval_results.comparison_artifact_path,
      indexed_eval_results.comparison_commit_sha,
      indexed_eval_results.total_cases,
      indexed_eval_results.passed_cases,
      indexed_eval_results.failed_cases,
      indexed_eval_results.status,
      indexed_eval_results.executed_at,
      indexed_eval_results.indexed_at,
      indexed_eval_results.score_delta::float8 as score_delta,
      ${current.skill_id}::text as skill_id,
      ${current.skill_name}::text as skill_name,
      ${current.skill_tier}::text as skill_tier
    from indexed_eval_results
    inner join indexed_skills on indexed_skills.id = indexed_eval_results.indexed_skill_id
    left join indexed_eval_assets dataset_asset
      on dataset_asset.id = indexed_eval_results.dataset_asset_id
    left join indexed_eval_assets baseline_asset
      on baseline_asset.id = indexed_eval_results.baseline_asset_id
    where indexed_skills.organization_id = ${organizationId}
      and indexed_skills.skill_id = ${current.skill_id}
      and indexed_eval_results.id <> ${current.result_id}
    order by coalesce(indexed_eval_results.executed_at, indexed_eval_results.indexed_at) desc nulls last
    limit 20
  `;
}

async function queryReviewComments(
  organizationId: string,
  skillId: string,
): Promise<ReviewCommentRow[]> {
  const sql = await getControlPlaneDatabase();
  return sql<ReviewCommentRow[]>`
    select
      author.display_name as author_name,
      review_comments.body,
      review_comments.created_at
    from review_comments
    inner join review_requests on review_requests.id = review_comments.review_request_id
    left join users author on author.id = review_comments.author_user_id
    where review_requests.organization_id = ${organizationId}
      and review_requests.skill_id = ${skillId}
    order by review_comments.created_at desc
    limit 5
  `;
}

async function queryActiveRelease(
  organizationId: string,
  skillId: string,
  comparisonCommitSha: string | null,
): Promise<ActiveReleaseRow | null> {
  const sql = await getControlPlaneDatabase();

  if (comparisonCommitSha) {
    const matchingRows = await sql<ActiveReleaseRow[]>`
      select
        release_requests.id,
        release_requests.source_ref,
        release_requests.source_commit_sha,
        release_requests.from_environment,
        release_requests.to_environment,
        release_requests.created_at,
        requester.display_name as requested_by,
        coalesce(approval_counts.approved_count, 0)::int as approvals_done,
        coalesce(approval_counts.total_count, 0)::int as approvals_required,
        approval_counts.blocked_role as approvals_blocked,
        target_list.targets
      from release_requests
      left join users requester on requester.id = release_requests.requested_by
      left join lateral (
        select
          count(*)::int as total_count,
          count(*) filter (where status = 'approved')::int as approved_count,
          min(required_role) filter (where status <> 'approved') as blocked_role
        from release_approvals
        where release_request_id = release_requests.id
      ) approval_counts on true
      left join lateral (
        select array_agg(target_key order by target_key) as targets
        from release_targets
        where release_request_id = release_requests.id
      ) target_list on true
      where release_requests.organization_id = ${organizationId}
        and release_requests.skill_id = ${skillId}
        and release_requests.source_commit_sha = ${comparisonCommitSha}
        and release_requests.status in ('pending', 'approved', 'blocked')
      order by release_requests.created_at desc
      limit 1
    `;

    if (matchingRows[0]) {
      return matchingRows[0];
    }
  }

  const fallbackRows = await sql<ActiveReleaseRow[]>`
    select
      release_requests.id,
      release_requests.source_ref,
      release_requests.source_commit_sha,
      release_requests.from_environment,
      release_requests.to_environment,
      release_requests.created_at,
      requester.display_name as requested_by,
      coalesce(approval_counts.approved_count, 0)::int as approvals_done,
      coalesce(approval_counts.total_count, 0)::int as approvals_required,
      approval_counts.blocked_role as approvals_blocked,
      target_list.targets
    from release_requests
    left join users requester on requester.id = release_requests.requested_by
    left join lateral (
      select
        count(*)::int as total_count,
        count(*) filter (where status = 'approved')::int as approved_count,
        min(required_role) filter (where status <> 'approved') as blocked_role
      from release_approvals
      where release_request_id = release_requests.id
    ) approval_counts on true
    left join lateral (
      select array_agg(target_key order by target_key) as targets
      from release_targets
      where release_request_id = release_requests.id
    ) target_list on true
    where release_requests.organization_id = ${organizationId}
      and release_requests.skill_id = ${skillId}
      and release_requests.status in ('pending', 'approved', 'blocked')
    order by release_requests.created_at desc
    limit 1
  `;

  return fallbackRows[0] ?? null;
}

async function queryVersionRefs(
  organizationId: string,
  skillId: string,
): Promise<Map<string, string>> {
  const sql = await getControlPlaneDatabase();
  const rows = await sql<SkillVersionRow[]>`
    select commit_sha, version_ref
    from indexed_skill_versions
    where skill_id = ${skillId}
      and repository_id in (
        select repository_id
        from indexed_skills
        where organization_id = ${organizationId}
          and skill_id = ${skillId}
      )
    order by observed_at desc
    limit 50
  `;

  const versionRefsByCommit = new Map<string, string>();
  for (const row of rows) {
    if (!versionRefsByCommit.has(row.commit_sha)) {
      versionRefsByCommit.set(row.commit_sha, row.version_ref);
    }
  }

  return versionRefsByCommit;
}

export async function readEvaluationDetailFromDatabase(
  context: TenantReadContext,
  identifier: string,
): Promise<EvaluationDetailResponse | null> {
  const primaryRow = await queryPrimaryEvaluationRow(context.tenant.organizationId, identifier);

  if (!primaryRow) {
    return null;
  }

  const [skillsResponse, historicalRows, reviewComments, activeReleaseRow, versionRefsByCommit] = await Promise.all([
    readSkillsFromDatabase(context),
    queryHistoricalEvaluationRows(context.tenant.organizationId, primaryRow),
    queryReviewComments(context.tenant.organizationId, primaryRow.skill_id),
    queryActiveRelease(context.tenant.organizationId, primaryRow.skill_id, primaryRow.comparison_commit_sha),
    queryVersionRefs(context.tenant.organizationId, primaryRow.skill_id),
  ]);

  const skill = skillsResponse.data.find((candidate) => candidate.id === primaryRow.skill_id) ?? null;
  if (!skill) {
    return null;
  }

  const datasetLabel = resolveIndexedEvalDatasetLabel(primaryRow);
  const sameDatasetHistoricalRows = historicalRows.filter((row) => resolveIndexedEvalDatasetLabel(row) === datasetLabel);
  const comparableHistoricalRows = sameDatasetHistoricalRows.length > 0 ? sameDatasetHistoricalRows : historicalRows;
  const run = toEvaluationSummary(primaryRow, versionRefsByCommit);
  const baselineRow = comparableHistoricalRows[0];
  const baselineRun = baselineRow ? toEvaluationSummary(baselineRow, versionRefsByCommit) : null;
  const publishedRef = skill.ref !== "—" ? skill.ref : null;
  const historicalRuns = buildHistoricalRuns(comparableHistoricalRows.slice(0, 8), versionRefsByCommit, skill, publishedRef);
  const release = buildActiveRelease(run, activeReleaseRow);
  if (release) {
    release.skill = skill.name;
  }

  const focus = run.failed > 0
    ? `${datasetLabel} regressions`
    : `${datasetLabel} benchmark quality`;
  const failureClusters = buildFailureClusters(
    run,
    datasetLabel,
    primaryRow.comparison_artifact_path,
    primaryRow.baseline_source_path,
    skill,
  );
  const recommendations = buildRecommendations(run, skill, datasetLabel, baselineRun, failureClusters);
  const readOnly = primaryRow.comparison_commit_sha != null
    ? !(
      (skill.candidateCommit !== "—" && primaryRow.comparison_commit_sha === skill.candidateCommit)
      || (skill.commit !== "—" && primaryRow.comparison_commit_sha === skill.commit)
    ) && publishedRef != null
    : historicalRuns.length > 0 && publishedRef != null;

  const data: EvaluationRunDetail = {
    uuid: run.id,
    run,
    skill,
    baselineRun,
    release,
    executedBy: "control-plane index",
    executionEnvironment: primaryRow.dataset_source_path
      ? `Indexed benchmark · ${primaryRow.dataset_source_path}`
      : "Indexed benchmark run",
    candidateModel: "Not indexed",
    judgeModel: "Not indexed · balanced rubric judge",
    focus,
    readOnly,
    publishedRef,
    metrics: buildMetricStrip(run, baselineRun, release),
    metricAlignment: buildMetricAlignment(skill, datasetLabel, recommendations),
    failureClusters,
    recommendations,
    customTestPresets: buildCustomTestPresets(run, datasetLabel),
    reviewerNotes: buildReviewerNotes(run, focus, failureClusters, reviewComments),
    historicalRuns,
  };

  return {
    data,
    meta: createControlPlaneMeta("derived-index"),
  };
}
