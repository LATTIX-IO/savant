import { NextResponse } from "next/server";

import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import {
  listSkillsResponse,
  ReadModelUnavailableError,
} from "@/server/control-plane/read-model";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";

export async function GET(request: Request) {
  try {
    const tenantContext = await authorizeTenantRequest(request);
    const { searchParams } = new URL(request.url);
    const tierParam = searchParams.get("tier");
    const tier = tierParam ? Number(tierParam) : undefined;

    return NextResponse.json(
      await listSkillsResponse({
        channel: searchParams.get("channel") ?? undefined,
        query: searchParams.get("query") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        team: searchParams.get("team") ?? undefined,
        tier: Number.isFinite(tier) ? tier : undefined,
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