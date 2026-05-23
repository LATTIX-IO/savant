import type {
  PolicyListResponse,
  PolicySummary,
} from "@savant/types";
import { NextResponse } from "next/server";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { readPoliciesFromDatabase } from "@/server/control-plane/read-model-db";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";

async function buildFallbackPolicyListResponse(): Promise<PolicyListResponse> {
  const { POLICIES } = await import("@/lib/savant-data");

  const data = POLICIES.map<PolicySummary>((policy) => ({
    id: policy.id,
    name: policy.name,
    type: policy.type,
    scope: policy.scope,
    state: policy.state,
    affects: policy.affects,
    appliedBy: policy.appliedBy,
    updated: policy.updated,
    rules: policy.rules,
    recentActivity: [],
  }));

  return {
    data,
    meta: {
      ...createControlPlaneMeta("mixed"),
      count: data.length,
    },
  };
}

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);

    return NextResponse.json(
      tenantContext.isDevelopmentFallback
        ? await buildFallbackPolicyListResponse()
        : await readPoliciesFromDatabase(tenantContext),
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