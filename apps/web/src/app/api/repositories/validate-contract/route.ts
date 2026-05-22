import { NextResponse } from "next/server";

import type {
  RepoContractValidationRequest,
  RepoContractValidationResponse,
} from "@savant/types";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import {
  readJsonObject,
  readOptionalString,
  readOptionalStringArray,
  readRequiredString,
} from "@/server/control-plane/request-validation";
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

    const path = readRequiredString(body, "path", 40);
    const provider = readRequiredString(body, "provider", 60);
    const repoUrl = readRequiredString(body, "repoUrl", 400);
    const defaultBranch = readRequiredString(body, "defaultBranch", 100);
    const displayName = readRequiredString(body, "displayName", 120);
    const syncMode = readOptionalString(body, "syncMode", 20);

    if (!path || (path !== "connect" && path !== "provision")) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_repository_path",
          "Repository validation requires a path of 'connect' or 'provision'.",
        ),
        { status: 400 },
      );
    }

    if (!provider || !repoUrl || !defaultBranch || !displayName) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_repository_validation_request",
          "Repository validation requires provider, repoUrl, defaultBranch, and displayName.",
        ),
        { status: 400 },
      );
    }

    if (syncMode && syncMode !== "webhook" && syncMode !== "poll" && syncMode !== "manual") {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_sync_mode",
          "Repository validation syncMode must be webhook, poll, or manual.",
        ),
        { status: 400 },
      );
    }

    const validatedSyncMode: RepoContractValidationRequest["syncMode"] =
      syncMode === "webhook" || syncMode === "poll" || syncMode === "manual"
        ? syncMode
        : undefined;

    const requestBody: RepoContractValidationRequest = {
      path,
      provider,
      repoUrl,
      defaultBranch,
      displayName,
      syncMode: validatedSyncMode,
      observedPaths: readOptionalStringArray(body, "observedPaths"),
    };

    const response: RepoContractValidationResponse = {
      data: validateTenantSkillRepoContract(requestBody),
      meta: createControlPlaneMeta("git"),
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