import { NextResponse } from "next/server";

import type {
  RepoBootstrapTemplateRequest,
  RepoBootstrapTemplateResponse,
} from "@savant/types";

import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { readJsonObject, readOptionalString, readRequiredString } from "@/server/control-plane/request-validation";
import { generateTenantSkillRepoBootstrapTemplate } from "@/server/control-plane/repository-scaffold";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

export async function POST(request: Request) {
  try {
    await authorizeTenantRequest(request);

    const body = await readJsonObject(request);

    if (!body) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_json_body",
          "Expected a JSON object payload for repository bootstrap preview.",
        ),
        { status: 400 },
      );
    }

    const provider = readRequiredString(body, "provider", 60);
    const repoUrl = readRequiredString(body, "repoUrl", 400);
    const defaultBranch = readRequiredString(body, "defaultBranch", 100);
    const displayName = readRequiredString(body, "displayName", 120);
    const syncMode = readOptionalString(body, "syncMode", 20);

    if (!provider || !repoUrl || !defaultBranch || !displayName) {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_repo_bootstrap_request",
          "Repository bootstrap preview requires provider, repoUrl, defaultBranch, and displayName.",
        ),
        { status: 400 },
      );
    }

    if (syncMode === "webhook") {
      return NextResponse.json(
        createApiErrorResponse(
          "repository_sync_mode_disabled",
          "Webhook sync is disabled in the current secure MVP. Use poll or manual sync.",
        ),
        { status: 409 },
      );
    }

    if (syncMode && syncMode !== "poll" && syncMode !== "manual") {
      return NextResponse.json(
        createApiErrorResponse(
          "invalid_sync_mode",
          "Repository bootstrap preview syncMode must be poll or manual.",
        ),
        { status: 400 },
      );
    }

    const validatedSyncMode: RepoBootstrapTemplateRequest["syncMode"] =
      syncMode === "poll" || syncMode === "manual"
        ? syncMode
        : undefined;

    const requestBody: RepoBootstrapTemplateRequest = {
      provider,
      repoUrl,
      defaultBranch,
      displayName,
      syncMode: validatedSyncMode,
    };

    const response: RepoBootstrapTemplateResponse = {
      data: generateTenantSkillRepoBootstrapTemplate(requestBody),
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