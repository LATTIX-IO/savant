import { NextResponse } from "next/server";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import {
  getOverviewResponse,
  ReadModelUnavailableError,
} from "@/server/control-plane/read-model";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);
    return NextResponse.json(await getOverviewResponse(tenantContext));
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