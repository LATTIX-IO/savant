import { NextResponse } from "next/server";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";

/** Live telemetry arriving through the skill router: runs by runtime, outcomes, routing decisions, recent runs. */
export async function GET(request: Request) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
    const sql = getControlPlaneDatabase();
    const org = actor.organizationId;
    const [byRuntime, outcomes, routing, recent, skills] = await Promise.all([
      sql<{ runtime: string; runs: number }[]>`
        select runtime, count(*)::int as runs from skill_runs
        where organization_id = ${org} and task_archetype = 'skill-router' and started_at > now() - interval '30 days'
        group by runtime order by runs desc
      `,
      sql<{ task_outcome: string; count: number }[]>`
        select skill_outcomes.task_outcome, count(*)::int as count from skill_outcomes
        join skill_runs on skill_runs.id = skill_outcomes.skill_run_id
        where skill_runs.organization_id = ${org} and skill_runs.task_archetype = 'skill-router' and skill_runs.started_at > now() - interval '30 days'
        group by skill_outcomes.task_outcome
      `,
      sql<{ method: string; decisions: number; matched: number }[]>`
        select method, count(*)::int as decisions, count(chosen_skill_id)::int as matched from skill_route_decisions
        where organization_id = ${org} and created_at > now() - interval '30 days' group by method
      `,
      sql<{ run_id: string; skill_id: string; runtime: string; model: string | null; started_at: Date; task_outcome: string | null; human_accepted: boolean | null }[]>`
        select skill_runs.run_id, skill_runs.skill_id, skill_runs.runtime, skill_runs.model, skill_runs.started_at,
          (select task_outcome from skill_outcomes where skill_outcomes.skill_run_id = skill_runs.id order by recorded_at desc limit 1) as task_outcome,
          (select human_accepted from skill_outcomes where skill_outcomes.skill_run_id = skill_runs.id order by recorded_at desc limit 1) as human_accepted
        from skill_runs where organization_id = ${org} and task_archetype = 'skill-router'
        order by started_at desc limit 12
      `,
      sql<{ count: number }[]>`select count(distinct skill_id)::int as count from indexed_skills where organization_id = ${org}`,
    ]);
    return NextResponse.json({
      data: {
        governedSkills: skills[0]?.count ?? 0,
        byRuntime,
        outcomes: Object.fromEntries(outcomes.map((row) => [row.task_outcome, row.count])),
        routing,
        recent: recent.map((row) => ({ ...row, started_at: new Date(row.started_at).toISOString() })),
      },
      meta: gitMeta(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
