import { NextResponse } from "next/server";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import {
  createNotFoundResponse,
  getRepositoryDetailResponse,
  ReadModelUnavailableError,
} from "@/server/control-plane/read-model";
import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const tenantContext = await authorizeTenantRequest(request);
    const { id } = await context.params;
    const response = await getRepositoryDetailResponse(id, tenantContext);

    if (!response) {
      return NextResponse.json(
        createNotFoundResponse("repository_not_found", `Repository '${id}' was not found.`),
        { status: 404 },
      );
    }

    return NextResponse.json(response);
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

/**
 * Removes a repository and the indexed skills that belong only to it. The
 * provider connection is preserved.
 */
export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOriginMutationRequest(request);
    const tenantContext = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(tenantContext);
    const { id } = await context.params;
    const runtime = await getGitRuntime();
    const service = runtime.createRepositoryService({ enqueue: async () => ({ started: false }) });
    const data = await service.removeRepository(actor, id);
    return NextResponse.json({ data, meta: gitMeta() });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
