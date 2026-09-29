import { NextResponse } from "next/server";

import type { GitConnectionValidationResponse } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

/** Checks that a credential can be obtained, identity read, and repositories enumerated. */
export async function POST(request: Request, ctx: RouteContext<"/api/git/connections/[id]/validate">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const runtime = await getGitRuntime();
    const response: GitConnectionValidationResponse = { data: await runtime.connections.validateConnection(actor, id), meta: gitMeta() };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}
