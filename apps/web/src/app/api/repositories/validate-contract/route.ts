import { NextResponse } from "next/server";

import type {
  RepoContractValidationResponse,
} from "@savant/types";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { RepositoryProviderError } from "@/server/control-plane/repository-provider-read";
import {
  readJsonObject,
} from "@/server/control-plane/request-validation";
import { RepositoryRequestError, resolveRepositoryValidationRequest } from "@/server/control-plane/repository-request";
import { validateTenantSkillRepoContract } from "@/server/control-plane/repository-scaffold";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

export async function POST(request: Request) {
  try {
    await authorizeTenantRequest(request);

    const body = await readJsonObject(request);

    if (!body) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_json_body",
          "Expected a JSON object payload for repository contract validation.",
        ),
        { status: 400 },
      );
    }

    const { request: requestBody, validationSource } = await resolveRepositoryValidationRequest(body, {
      signal: request.signal,
    });

    const response: RepoContractValidationResponse = {
      data: validateTenantSkillRepoContract(requestBody, { validationSource }),
      meta: createControlPlaneMeta("git"),
    };

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof RepositoryProviderError) {
      return NextResponse.json(
        createApiErrorResponse(error.code, error.message, error.details),
        { status: error.status },
      );
    }

    if (error instanceof RepositoryRequestError) {
      return NextResponse.json(
        createApiErrorResponse(error.code, error.message, error.details),
        { status: error.status },
      );
    }

    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    throw error;
  }
}