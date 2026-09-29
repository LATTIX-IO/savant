import { NextResponse } from "next/server";

import type { GitConnectionResponse } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

export async function GET(request: Request, ctx: RouteContext<"/api/git/connections/[id]">) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const runtime = await getGitRuntime();
    const response: GitConnectionResponse = { data: await runtime.connections.getConnection(actor, id), meta: gitMeta() };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}

/**
 * Disconnects a provider: revokes remotely where supported, deletes the stored
 * credential, marks associated repositories auth_required, and keeps
 * repository metadata and indexed skills.
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/git/connections/[id]">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const runtime = await getGitRuntime();
    const result = await runtime.connections.disconnectConnection(actor, id);
    return NextResponse.json({ data: result, meta: gitMeta() });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
