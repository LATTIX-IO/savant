import { NextResponse } from "next/server";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

/** Assessment findings for one skill (by skill id), from its repository's latest assessment. */
export async function GET(request: Request, ctx: RouteContext<"/api/skills/[id]/assessment">) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const skillId = new URL(request.url).searchParams.get("skillId") ?? decodeURIComponent(id);
    const runtime = await getGitRuntime();
    return NextResponse.json({ data: await runtime.assessments.getSkillFindings(actor, skillId.slice(0, 300)), meta: gitMeta() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
