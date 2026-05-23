import { NextResponse } from "next/server";

import type {
  AIConnectionCreateRequest,
  AIConnectionListResponse,
  AIConnectionResponse,
} from "@savant/types";

import {
  AIConnectionError,
  createAIConnectionForTenant,
  listAIConnectionSummariesForOrganization,
} from "@/server/control-plane/ai-connections";
import { AIConnectionSecretStoreError } from "@/server/control-plane/ai-connection-secrets";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { MutationRequestSecurityError, assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import {
  readJsonObject,
  readOptionalBoolean,
  readOptionalString,
  readOptionalStringArray,
  readRequiredString,
} from "@/server/control-plane/request-validation";
import { TenantAuthorizationError } from "@/server/control-plane/tenant-authorization";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

function readCreateAIConnectionRequest(body: Record<string, unknown>): AIConnectionCreateRequest | null {
  const provider = readRequiredString(body, "provider", 40);
  const label = readRequiredString(body, "label", 120);
  const defaultModel = readRequiredString(body, "defaultModel", 160);
  const purpose = readRequiredString(body, "purpose", 240);
  const usageScope = readRequiredString(body, "usageScope", 240);
  const apiKey = readRequiredString(body, "apiKey", 400);

  if (!provider || !label || !defaultModel || !purpose || !usageScope || !apiKey) {
    return null;
  }

  return {
    provider,
    label,
    defaultModel,
    purpose,
    usageScope,
    apiKey,
    allowedModels: readOptionalStringArray(body, "allowedModels", 160),
    supportsExecution: readOptionalBoolean(body, "supportsExecution"),
    supportsJudging: readOptionalBoolean(body, "supportsJudging"),
    isDefaultExecution: readOptionalBoolean(body, "isDefaultExecution"),
    isDefaultJudge: readOptionalBoolean(body, "isDefaultJudge"),
    baseUrl: readOptionalString(body, "baseUrl", 500),
    apiVersion: readOptionalString(body, "apiVersion", 80),
  };
}

export async function GET(request: Request) {
  try {
    const { tenant } = await authorizeTenantRequest(request);
    const data = await listAIConnectionSummariesForOrganization(tenant.organizationId);
    const response: AIConnectionListResponse = {
      data,
      meta: {
        ...createControlPlaneMeta("database"),
        count: data.length,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    throw error;
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const body = await readJsonObject(request);

    if (!body) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_json_body",
          "Expected a JSON object payload for AI connection creation.",
        ),
        { status: 400 },
      );
    }

    const createRequest = readCreateAIConnectionRequest(body);
    if (!createRequest) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_ai_connection_request",
          "provider, label, defaultModel, purpose, usageScope, and apiKey are required to create a BYO-AI connection.",
        ),
        { status: 400 },
      );
    }

    const data = await createAIConnectionForTenant({
      context,
      request: createRequest,
    });
    const response: AIConnectionResponse = {
      data,
      meta: createControlPlaneMeta("database"),
    };

    return NextResponse.json(response, { status: 201 });
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
