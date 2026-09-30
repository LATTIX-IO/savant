import { NextResponse } from "next/server";

import type { ChangeProposalResponse } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

export const maxDuration = 120;

/**
 * Approves a change proposal and opens a pull request on a new branch. The
 * repository's branch protection and review rules decide when it merges.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/proposals/[id]/approve">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const runtime = await getGitRuntime();
    const response: ChangeProposalResponse = { data: await runtime.assessments.approveProposal(actor, id), meta: gitMeta() };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}
