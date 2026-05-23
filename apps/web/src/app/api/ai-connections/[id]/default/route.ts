import { NextResponse } from "next/server";

import type {
  AIConnectionResponse,
  AIConnectionSetDefaultRequest,
} from "@savant/types";

import { AIConnectionError, setAIConnectionDefaultsForTenant } from "@/server/control-plane/ai-connections";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { MutationRequestSecurityError, assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { readJsonObject, readOptionalBoolean } from "@/server/control-plane/request-validation";
import { TenantAuthorizationError } from "@/server/control-plane/tenant-authorization";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

function readDefaultRequest(body: Record<string, unknown> | null): AIConnectionSetDefaultRequest | null {
  if (!body) {
    return null;
  }

  const setAsExecutionDefault = readOptionalBoolean(body, "setAsExecutionDefault");
  const setAsJudgeDefault = readOptionalBoolean(body, "setAsJudgeDefault");
  if (setAsExecutionDefault === undefined && setAsJudgeDefault === undefined) {
    return null;
  }

  return {
    setAsExecutionDefault,
    setAsJudgeDefault,
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
    const defaultRequest = readDefaultRequest(body);

    if (!defaultRequest) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_ai_connection_default_request",
          "setAsExecutionDefault or setAsJudgeDefault must be provided when updating AI defaults.",
        ),
        { status: 400 },
      );
    }

    const data = await setAIConnectionDefaultsForTenant({
      context,
      aiConnectionId: id,
      request: defaultRequest,
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
