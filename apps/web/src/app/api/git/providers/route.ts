import { NextResponse } from "next/server";

import type { GitProviderListResponse } from "@savant/types";

import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";

export async function GET(request: Request) {
  try {
    const context = await authorizeTenantRequest(request);
    await resolveGitActorForTenant(context);
    const runtime = await getGitRuntime();
    const response: GitProviderListResponse = { data: runtime.connections.listProviders(), meta: gitMeta() };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}
