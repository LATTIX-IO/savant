import type {
  EvaluationDashboardResponse,
  EvaluationRunListItem,
  EvaluationTierCoverageItem,
} from "@savant/types";
import { NextResponse } from "next/server";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import {
  buildEvaluationDashboardMetrics,
  readEvaluationsDashboardFromDatabase,
} from "@/server/control-plane/read-model-db";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";

function parseFixtureRelativeTimestamp(label: string): string | null {
  const now = Date.now();
  const normalized = label.trim().toLowerCase();

  if (normalized === "now") {
    return new Date(now).toISOString();
  }

  const minuteMatch = normalized.match(/^(\d+)m ago$/);
  if (minuteMatch) {
    return new Date(now - (Number.parseInt(minuteMatch[1] ?? "0", 10) * 60 * 1000)).toISOString();
  }

  const hourMatch = normalized.match(/^(\d+)h ago$/);
  if (hourMatch) {
    return new Date(now - (Number.parseInt(hourMatch[1] ?? "0", 10) * 60 * 60 * 1000)).toISOString();
  }

  const dayMatch = normalized.match(/^(\d+)d ago$/);
  if (dayMatch) {
    return new Date(now - (Number.parseInt(dayMatch[1] ?? "0", 10) * 24 * 60 * 60 * 1000)).toISOString();
  }

  return null;
}

async function buildFallbackEvaluationDashboardResponse(): Promise<EvaluationDashboardResponse> {
  const { EVAL_RUNS, SKILLS } = await import("@/lib/savant-data");

  const runs = EVAL_RUNS.map<EvaluationRunListItem>((run) => {
    const skill = SKILLS.find((candidate) => candidate.name === run.skill) ?? null;
    const startedAt = parseFixtureRelativeTimestamp(run.started);

    return {
      id: run.id,
      skillId: skill?.id ?? run.skill,
      skill: run.skill,
      skillTier: skill?.tier ?? 2,
      ref: run.ref,
      dataset: run.dataset,
      cases: run.cases,
      passed: run.passed,
      failed: run.failed,
      started: run.started,
      startedAt,
      duration: run.duration,
      passRate: Math.round((run.passed * 1000) / Math.max(run.cases, 1)) / 10,
      delta: run.delta,
      status: run.status,
    };
  });

  const totalSkillsByTier = {
    1: SKILLS.filter((skill) => skill.tier === 1).length,
    2: SKILLS.filter((skill) => skill.tier === 2).length,
    3: SKILLS.filter((skill) => skill.tier === 3).length,
  } satisfies Record<1 | 2 | 3, number>;

  const evaluatedSkillsByTier = {
    1: new Set(runs.filter((run) => run.skillTier === 1).map((run) => run.skillId)).size,
    2: new Set(runs.filter((run) => run.skillTier === 2).map((run) => run.skillId)).size,
    3: new Set(runs.filter((run) => run.skillTier === 3).map((run) => run.skillId)).size,
  } satisfies Record<1 | 2 | 3, number>;

  const coverageByTier: EvaluationTierCoverageItem[] = ([1, 2, 3] as const).map((tier) => ({
    tier,
    evaluatedSkills: evaluatedSkillsByTier[tier],
    totalSkills: totalSkillsByTier[tier],
    coveragePct: totalSkillsByTier[tier] > 0
      ? Math.round((evaluatedSkillsByTier[tier] / totalSkillsByTier[tier]) * 1000) / 10
      : 0,
  }));

  const regressions = runs.filter((run) => run.status === "complete-with-regressions" || run.status === "failed");

  return {
    data: {
      kpis: buildEvaluationDashboardMetrics({
        totalSkills: SKILLS.length,
        evaluatedSkills: new Set(runs.map((run) => run.skillId)).size,
        averageCasesPerRun: runs.length > 0
          ? runs.reduce((sum, run) => sum + run.cases, 0) / runs.length
          : null,
        totalRuns: runs.length,
        regressionsLast24h: regressions.length,
        latestRegressionSkill: regressions[0]?.skill ?? null,
        medianPassRate: runs.length > 0
          ? [...runs].sort((left, right) => left.passRate - right.passRate)[Math.floor(runs.length / 2)]?.passRate ?? null
          : null,
        runningRuns: runs.filter((run) => run.status === "running").length,
        regressionRuns: regressions.length,
      }),
      runs,
      coverageByTier,
    },
    meta: createControlPlaneMeta("mixed"),
  };
}

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);

    return NextResponse.json(
      tenantContext.isDevelopmentFallback
        ? await buildFallbackEvaluationDashboardResponse()
        : await readEvaluationsDashboardFromDatabase(tenantContext),
    );
  } catch (error) {
    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    throw error;
  }
}