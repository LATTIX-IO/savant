import { NextResponse } from "next/server";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";
import { kickBackgroundJobs } from "@/server/jobs/runner";
import { startEvalGeneration } from "@/server/jobs/skill-automation";

export const maxDuration = 300;

/**
 * Starts LLM↔Jev evaluation generation for a skill. Skills without a scored
 * dataset get a generated set proposed as a pull request; skills with one get
 * an alignment check against it.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/skills/[id]/automation/generate">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const skillId = new URL(request.url).searchParams.get("skillId") ?? decodeURIComponent(id);
    const run = await startEvalGeneration(actor, skillId.slice(0, 300));
    await kickBackgroundJobs();
    return NextResponse.json({ data: { ...run, files: [] }, meta: gitMeta() }, { status: 202 });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
