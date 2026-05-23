import { NextResponse } from "next/server";

import type {
  AIConnectionResponse,
  AIConnectionRevokeRequest,
} from "@savant/types";

import { AIConnectionError, revokeAIConnectionForTenant } from "@/server/control-plane/ai-connections";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { MutationRequestSecurityError, assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { readJsonObject, readOptionalString } from "@/server/control-plane/request-validation";
import { TenantAuthorizationError } from "@/server/control-plane/tenant-authorization";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

function readRevokeRequest(body: Record<string, unknown> | null): AIConnectionRevokeRequest {
  if (!body) {
    return {};
  }

  return {
    reason: readOptionalString(body, "reason", 240),
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const { id } = await params;
    const body = await readJsonObject(request);
    const data = await revokeAIConnectionForTenant({
      context,
      aiConnectionId: id,
      reason: readRevokeRequest(body).reason,
    });
    const response: AIConnectionResponse = {
      data,
      meta: createControlPlaneMeta("database"),
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    if (error instanceof MutationRequestSecurityError || error instanceof TenantAuthorizationError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    if (error instanceof AIConnectionError) {
      return NextResponse.json(
        createApiErrorResponse(error.code, error.message, error.details),
        { status: error.status },
      );
    }

    throw error;
  }
}
