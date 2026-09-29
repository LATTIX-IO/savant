import { NextResponse } from "next/server";

import type { GitAuthorizeResponse } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

/** Starts reauthorization of an existing connection (including legacy env-backed ones). */
export async function POST(request: Request, ctx: RouteContext<"/api/git/connections/[id]/reauthorize">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const body = await readJsonBody(request).catch(() => ({} as Record<string, unknown>));
    const runtime = await getGitRuntime();
    const connection = await runtime.connections.getConnection(actor, id);
    const authorizationUrl = await runtime.connections.startAuthorization(actor, {
      provider: connection.provider,
      workspaceSlug: context.tenant.workspaceSlug,
      returnPath: readOptionalString(body, "returnPath", 500),
      clientId: readOptionalString(body, "clientId", 300),
      clientSecret: readOptionalString(body, "clientSecret", 500),
      reauthorizeConnectionId: id,
    });
    const response: GitAuthorizeResponse = { data: { authorizationUrl }, meta: gitMeta() };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}
