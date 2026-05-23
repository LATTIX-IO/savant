import { NextResponse } from "next/server";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import {
  getSkillSourceResponse,
  normalizeSkillSourceUpdateRequest,
  SkillSourceError,
  updateSkillSourceInRepository,
} from "@/server/control-plane/skill-source";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import {
  RepositoryProviderConnectionError,
} from "@/server/control-plane/repository-provider-connection";
import { RepositoryProviderError } from "@/server/control-plane/repository-provider-read";
import { readJsonObject } from "@/server/control-plane/request-validation";
import { RepositoryIndexError } from "@/server/control-plane/repository-index";
import { TenantWriteAccessError } from "@/server/control-plane/tenant-write-access";

function createHandledErrorResponse(error: {
  code: string;
  message: string;
  status: number;
  details?: string | undefined;
}) {
  return NextResponse.json(
    createApiErrorResponse(error.code, error.message, error.details),
    { status: error.status },
  );
}

function isKnownSkillSourceRouteError(error: unknown): error is {
  code: string;
  message: string;
  status: number;
  details?: string | undefined;
} {
  return error instanceof SkillSourceError
    || error instanceof RepositoryProviderConnectionError
    || error instanceof RepositoryProviderError
    || error instanceof RepositoryIndexError
    || error instanceof TenantWriteAccessError
    || error instanceof TenantContextError;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantContext = await authorizeTenantRequest(request);
    const { id } = await context.params;
    const response = await getSkillSourceResponse(id, tenantContext);

    if (!response) {
      return NextResponse.json(
        createApiErrorResponse("skill_not_found", `Skill '${id}' was not found.`),
        { status: 404 },
      );
    }

    return NextResponse.json(response);
  } catch (error) {
    if (isKnownSkillSourceRouteError(error)) {
      return createHandledErrorResponse(error);
    }

    throw error;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantContext = await authorizeTenantRequest(request);
    const body = await readJsonObject(request);

    if (!body) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_json_body",
          "Expected a JSON object payload for skill source updates.",
        ),
        { status: 400 },
      );
    }

    const normalized = normalizeSkillSourceUpdateRequest(body);

    if (!normalized) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_skill_source_update_request",
          "Provide non-empty markdown content shorter than 200000 characters.",
        ),
        { status: 400 },
      );
    }

    const { id } = await context.params;
    const payload = await updateSkillSourceInRepository({
      context: tenantContext,
      skillId: id,
      request: normalized,
    });

    return NextResponse.json(
      {
        data: payload,
        meta: {
          generatedAt: new Date().toISOString(),
          schemaVersion: 1 as const,
          sourceOfTruth: "git" as const,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    if (isKnownSkillSourceRouteError(error)) {
      return createHandledErrorResponse(error);
    }

    throw error;
  }
}
