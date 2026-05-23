import type {
  ReleaseDashboardResponse,
  ReleaseHistoryItem,
  ReleaseQueueItem,
} from "@savant/types";
import { NextResponse } from "next/server";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import {
  buildReleaseDashboardMetrics,
  readReleasesDashboardFromDatabase,
} from "@/server/control-plane/read-model-db";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";

function parseFixtureRelativeDays(label: string): number | null {
  const match = label.trim().toLowerCase().match(/^(\d+)d ago$/);
  return match ? Number.parseInt(match[1] ?? "0", 10) : null;
}

async function buildFallbackReleaseDashboardResponse(): Promise<ReleaseDashboardResponse> {
  const { RELEASES, RELEASE_HISTORY } = await import("@/lib/savant-data");

  const inMotion = RELEASES.map<ReleaseQueueItem>((release) => ({
    id: release.id,
    skill: release.skill,
    candidateRef: release.candidateRef,
    candidateCommit: release.candidateCommit,
    fromEnv: release.fromEnv,
    toEnv: release.toEnv,
    requested: release.requested,
    when: release.when,
    approvalsDone: release.approvalsDone,
    approvalsRequired: release.approvalsRequired,
    approvalsBlocked: release.approvalsBlocked,
    readinessPct: release.readinessPct,
    readiness: release.readiness,
    targets: release.targets,
  }));

  const history = RELEASE_HISTORY.map<ReleaseHistoryItem>((item) => ({
    ref: item.ref,
    skill: item.skill,
    env: item.env as ReleaseHistoryItem["env"],
    who: item.who,
    when: item.when,
    outcome: item.outcome === "rolled-back" ? "rolled-back" : "released",
  }));

  const latestRollback = history.find((item) => item.outcome === "rolled-back") ?? null;
  const newPinsLast7d = history.filter((item) => {
    if (item.env !== "production") {
      return false;
    }

    const relativeDays = parseFixtureRelativeDays(item.when);
    return relativeDays != null && relativeDays <= 7;
  }).length;

  return {
    data: {
      kpis: buildReleaseDashboardMetrics({
        activeCandidates: inMotion.length,
        blockedCandidates: inMotion.filter((item) => item.approvalsBlocked != null).length,
        readyCandidates: inMotion.filter((item) => item.readiness.every((check) => check.ok === true)).length,
        averageTurnaroundDaysLast30d: 2.4,
        averageTurnaroundDaysPrev30d: 3,
        releasedCountLast30d: history.filter((item) => item.outcome === "released").length,
        rollbackCountLast30d: history.filter((item) => item.outcome === "rolled-back").length,
        latestRollback,
        pinnedInProduction: history.filter((item) => item.env === "production").length,
        newPinsLast7d,
      }),
      inMotion,
      history,
    },
    meta: {
      ...createControlPlaneMeta("mixed"),
    },
  };
}

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);

    return NextResponse.json(
      tenantContext.isDevelopmentFallback
        ? await buildFallbackReleaseDashboardResponse()
        : await readReleasesDashboardFromDatabase(tenantContext),
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