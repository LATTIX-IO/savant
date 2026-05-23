import { NextResponse } from "next/server";

import type {
  AIConnectionResponse,
  AIConnectionRotateRequest,
} from "@savant/types";

import { AIConnectionError, rotateAIConnectionForTenant } from "@/server/control-plane/ai-connections";
import { AIConnectionSecretStoreError } from "@/server/control-plane/ai-connection-secrets";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { MutationRequestSecurityError, assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import {
  readJsonObject,
  readOptionalString,
  readOptionalStringArray,
  readRequiredString,
} from "@/server/control-plane/request-validation";
import { TenantAuthorizationError } from "@/server/control-plane/tenant-authorization";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

function readRotateRequest(body: Record<string, unknown> | null): AIConnectionRotateRequest | null {
  if (!body) {
    return null;
  }

  const apiKey = readRequiredString(body, "apiKey", 400);
  if (!apiKey) {
    return null;
  }

  return {
    apiKey,
    defaultModel: readOptionalString(body, "defaultModel", 160),
    purpose: readOptionalString(body, "purpose", 240),
    usageScope: readOptionalString(body, "usageScope", 240),
    allowedModels: readOptionalStringArray(body, "allowedModels", 160),
    baseUrl: readOptionalString(body, "baseUrl", 500),
    apiVersion: readOptionalString(body, "apiVersion", 80),
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
    const rotateRequest = readRotateRequest(body);

    if (!rotateRequest) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_ai_connection_rotate_request",
          "apiKey is required to rotate an AI connection secret.",
        ),
        { status: 400 },
      );
    }

    const data = await rotateAIConnectionForTenant({
      context,
      aiConnectionId: id,
      request: rotateRequest,
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

    if (error instanceof AIConnectionError || error instanceof AIConnectionSecretStoreError) {
      return NextResponse.json(
        createApiErrorResponse(error.code, error.message, error instanceof AIConnectionError ? error.details : undefined),
        { status: error.status },
      );
    }

    throw error;
  }
}
