import { NextResponse } from "next/server";

import type { ChangeProposalResponse } from "@savant/types";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

export async function GET(request: Request, ctx: RouteContext<"/api/proposals/[id]">) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const runtime = await getGitRuntime();
    const response: ChangeProposalResponse = { data: await runtime.assessments.getProposal(actor, id), meta: gitMeta() };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
