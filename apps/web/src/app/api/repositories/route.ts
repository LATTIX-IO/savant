import { after, NextResponse } from "next/server";

import type { RepositoryConnectSelectionResponse } from "@savant/types";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import {
  listRepositoriesResponse,
  ReadModelUnavailableError,
} from "@/server/control-plane/read-model";
import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { createAfterResponseIndexScheduler, getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);
    const { searchParams } = new URL(request.url);

    return NextResponse.json(
      await listRepositoriesResponse({
        provider: searchParams.get("provider") ?? undefined,
        status: searchParams.get("status") ?? undefined,
      }, tenantContext),
    );
  } catch (error) {
    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    if (error instanceof ReadModelUnavailableError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    throw error;
  }
}

export const maxDuration = 300;

/**
 * Connects repositories chosen from provider discovery. Each repository is
 * validated with the connection's credential, persisted idempotently with an
 * explicit connection association, and an initial index is started.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const body = await readJsonBody(request);
    const connectionId = readOptionalString(body, "connectionId", 64);
    const repositories = Array.isArray(body.repositories) ? body.repositories : null;

    if (!connectionId || !repositories) {
      throw new GitProviderError("INVALID_REQUEST", "connectionId and repositories are required.");
    }

    const selections = repositories
      .filter((entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null)
      .map((entry) => ({
        providerRepositoryId: readOptionalString(entry, "providerRepositoryId", 200) ?? "",
        fullName: readOptionalString(entry, "fullName", 400),
      }));

    const runtime = await getGitRuntime();
    const service = runtime.createRepositoryService(createAfterResponseIndexScheduler(after));
    const data = await service.connectSelectedRepositories(actor, { connectionId, repositories: selections });
    const response: RepositoryConnectSelectionResponse = { data, meta: gitMeta() };

    return NextResponse.json(response, { status: data.connected.some((entry) => entry.repository.created) ? 201 : 200 });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
