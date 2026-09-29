import { NextResponse } from "next/server";

import type { GitAuthorizeResponse } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";
import { isGitProviderType } from "@/server/git/types";

/**
 * Starts provider authorization. The `[id]` segment is the provider type here
 * (`/api/git/connections/github/authorize`). Returns the provider URL; the
 * organization is bound server-side into single-use state.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/git/connections/[id]/authorize">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id: provider } = await ctx.params;

    if (!isGitProviderType(provider)) {
      throw new GitProviderError("INVALID_REQUEST", `Unknown provider '${provider.slice(0, 40)}'.`);
    }

    const body = await readJsonBody(request).catch(() => ({} as Record<string, unknown>));
    const runtime = await getGitRuntime();
    const authorizationUrl = await runtime.connections.startAuthorization(actor, {
      provider,
      workspaceSlug: context.tenant.workspaceSlug,
      returnPath: readOptionalString(body, "returnPath", 500),
      host: readOptionalString(body, "host", 300),
      clientId: readOptionalString(body, "clientId", 300),
      clientSecret: readOptionalString(body, "clientSecret", 500),
    });

    const response: GitAuthorizeResponse = { data: { authorizationUrl }, meta: gitMeta() };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}
