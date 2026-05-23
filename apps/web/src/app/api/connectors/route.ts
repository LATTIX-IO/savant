import type {
  ConnectorDashboardResponse,
  ConnectorRecord,
} from "@savant/types";
import { NextResponse } from "next/server";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import {
  buildConnectorDashboardMetrics,
  readConnectorsDashboardFromDatabase,
} from "@/server/control-plane/read-model-db";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";

async function buildFallbackConnectorDashboardResponse(): Promise<ConnectorDashboardResponse> {
  const { CONNECTORS } = await import("@/lib/savant-data");

  const connectors = CONNECTORS.map<ConnectorRecord>((connector) => ({
    id: connector.id,
    name: connector.name,
    category: connector.category,
    kind: connector.kind,
    status: connector.status,
    lastSync: connector.lastSync,
    version: connector.version,
    skills: connector.skills,
    users: connector.users,
    scope: connector.scope,
  }));

  return {
    data: {
      kpis: buildConnectorDashboardMetrics({
        activeConnectors: connectors.filter((connector) => connector.status !== "offline").length,
        totalConnectors: connectors.length,
        enabledTargets: connectors.filter((connector) => connector.scope.trim().length > 0).length,
        localConnectors: connectors.filter((connector) => connector.category === "local").length,
        nativeConnectors: connectors.filter((connector) => connector.category === "native").length,
        notifyConnectors: connectors.filter((connector) => connector.category === "notify").length,
        bundleConnectors: connectors.filter((connector) => connector.category === "bundle").length,
        syncRuns24h: 0,
        successfulRuns24h: 0,
        failedRuns24h: 0,
        issues: connectors.filter((connector) => connector.status !== "healthy").length,
        degradedCount: connectors.filter((connector) => connector.status === "degraded").length,
        warningCount: connectors.filter((connector) => connector.status === "warning").length,
        offlineCount: connectors.filter((connector) => connector.status === "offline").length,
      }),
      connectors,
    },
    meta: createControlPlaneMeta("mixed"),
  };
}

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);

    return NextResponse.json(
      tenantContext.isDevelopmentFallback
        ? await buildFallbackConnectorDashboardResponse()
        : await readConnectorsDashboardFromDatabase(tenantContext),
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