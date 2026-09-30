import { NextResponse } from "next/server";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";
import { hasPendingJobs, kickBackgroundJobs } from "@/server/jobs/runner";
import { getSkillAutomation } from "@/server/jobs/skill-automation";

// Polling this also continues queued background work that ran out of time.
export const maxDuration = 300;

/** Evaluation generation runs and the latest SkillSpector safety scan for one skill. */
export async function GET(request: Request, ctx: RouteContext<"/api/skills/[id]/automation">) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const skillId = new URL(request.url).searchParams.get("skillId") ?? decodeURIComponent(id);
    const data = await getSkillAutomation(actor, skillId.slice(0, 300));
    if (await hasPendingJobs().catch(() => false)) {
      await kickBackgroundJobs();
    }
    return NextResponse.json({ data, meta: gitMeta() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
