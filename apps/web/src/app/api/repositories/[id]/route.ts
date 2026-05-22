import { NextResponse } from "next/server";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { createNotFoundResponse, getRepositoryDetailResponse } from "@/server/control-plane/read-model";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

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

    throw error;
  }
}