import type { ResolvedTenantContext } from "./tenant-context.ts";

import {
  buildSavantShellData,
  EMPTY_SAVANT_SHELL_DATA,
  type SavantShellData,
} from "../../lib/shell-state.ts";

type SavantShellCountRow = {
  skill_count: number;
  repository_count: number;
  evaluation_count: number;
  running_evaluation_count: number;
  release_count: number;
  active_policy_count: number;
  connector_count: number;
};

type SavantShellCountInput = {
  skillCount: number;
  repositoryCount: number;
  releaseCount: number;
  activePolicyCount: number;
  connectorCount: number;
  evaluationCount?: number | null;
};

async function loadControlPlaneDatabase() {
  const { getControlPlaneDatabase } = await import("./database.ts");
  return getControlPlaneDatabase();
}

async function querySavantShellCountRow(organizationId: string): Promise<SavantShellCountRow> {
  const sql = await loadControlPlaneDatabase();
  const rows = await sql<SavantShellCountRow[]>`
    with skill_counts as (
      select count(*)::int as skill_count
      from indexed_skills
      where organization_id = ${organizationId}
    ), repository_counts as (
      select count(*)::int as repository_count
      from repositories
      where organization_id = ${organizationId}
    ), evaluation_counts as (
      select
        count(*)::int as evaluation_count,
        count(*) filter (where indexed_eval_results.status = 'running')::int as running_evaluation_count
      from indexed_eval_results
      inner join indexed_skills on indexed_skills.id = indexed_eval_results.indexed_skill_id
      where indexed_skills.organization_id = ${organizationId}
    ), release_counts as (
      select count(*)::int as release_count
      from release_requests
      where organization_id = ${organizationId}
        and status in ('pending', 'approved', 'blocked')
    ), policy_counts as (
      select count(*) filter (where state = 'active')::int as active_policy_count
      from access_policies
      where organization_id = ${organizationId}
    ), connector_counts as (
      select count(*)::int as connector_count
      from connector_installations
      where organization_id = ${organizationId}
    )
    select
      skill_counts.skill_count,
      repository_counts.repository_count,
      evaluation_counts.evaluation_count,
      evaluation_counts.running_evaluation_count,
      release_counts.release_count,
      policy_counts.active_policy_count,
      connector_counts.connector_count
    from skill_counts, repository_counts, evaluation_counts, release_counts, policy_counts, connector_counts
  `;

  return rows[0] ?? {
    skill_count: 0,
    repository_count: 0,
    evaluation_count: 0,
    running_evaluation_count: 0,
    release_count: 0,
    active_policy_count: 0,
    connector_count: 0,
  };
}

async function buildFallbackSavantShellData(): Promise<SavantShellData> {
  const { CONNECTORS, EVAL_RUNS, POLICIES, RELEASES, REPOS, SKILLS } = await import("../../lib/savant-data.ts");

  return buildSavantShellDataFromCounts({
    skillCount: SKILLS.length,
    repositoryCount: REPOS.length,
    releaseCount: RELEASES.length,
    activePolicyCount: POLICIES.filter((policy) => policy.state === "active").length,
    connectorCount: CONNECTORS.length,
    evaluationCount: EVAL_RUNS.filter((run) => run.status === "running").length || EVAL_RUNS.length,
  });
}

export function buildSavantShellDataFromCounts(input: SavantShellCountInput): SavantShellData {
  return buildSavantShellData({
    skills: input.skillCount,
    repositories: input.repositoryCount,
    evaluations: input.evaluationCount ?? null,
    releases: input.releaseCount,
    policies: input.activePolicyCount,
    connectors: input.connectorCount,
  });
}

export async function getSavantShellData(
  context?: ResolvedTenantContext,
): Promise<SavantShellData> {
  if (!context) {
    return EMPTY_SAVANT_SHELL_DATA;
  }

  if (context.isDevelopmentFallback) {
    return buildFallbackSavantShellData();
  }

  const counts = await querySavantShellCountRow(context.tenant.organizationId);

  return buildSavantShellDataFromCounts({
    skillCount: counts.skill_count,
    repositoryCount: counts.repository_count,
    evaluationCount: counts.running_evaluation_count > 0
      ? counts.running_evaluation_count
      : counts.evaluation_count,
    releaseCount: counts.release_count,
    activePolicyCount: counts.active_policy_count,
    connectorCount: counts.connector_count,
  });
}