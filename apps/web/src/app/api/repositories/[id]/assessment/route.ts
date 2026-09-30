import { NextResponse } from "next/server";

import type { RepositoryAssessmentResponse } from "@savant/types";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

/** Latest post-sync assessment (findings with dismissed/proposed status) and change proposals. */
export async function GET(request: Request, ctx: RouteContext<"/api/repositories/[id]/assessment">) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const runtime = await getGitRuntime();
    const response: RepositoryAssessmentResponse = { data: await runtime.assessments.getRepositoryAssessment(actor, id), meta: gitMeta() };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
