import { NextResponse } from "next/server";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { assertGitPermission } from "@/server/git/access-control";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";
import { readAiServiceConfig } from "@/server/ai/clients";
import { enqueueHubEval } from "@/server/hub/jobs";
import { getCatalogSkill } from "@/server/hub/catalog-read";
import { createJobQueue } from "@/server/jobs/queue";
import { kickBackgroundJobs } from "@/server/jobs/runner";

export const maxDuration = 300;

/** Runs a live LLM↔Jev evaluation of a catalog skill (it has no answer key), and a safety scan if one is pending. */
export async function POST(request: Request, ctx: RouteContext<"/api/catalog/[id]/analyze">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    assertGitPermission(actor, "connect_repository");
    const config = readAiServiceConfig();
    if (!config.nim || !config.jev) {
      throw new GitProviderError("PROVIDER_NOT_CONFIGURED", "Live analysis needs NVIDIA_NIM_API_KEY and JEV_API_KEY.", { status: 409 });
    }
    const { id } = await ctx.params;
    const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
    const sql = getControlPlaneDatabase();
    const skill = await getCatalogSkill(sql, id);
    if (!skill) {
      throw new GitProviderError("INVALID_REQUEST", "That catalog skill wasn't found.", { status: 404 });
    }
    const queue = createJobQueue(sql);
    if (skill.evalStatus !== "queued" && skill.evalStatus !== "running") {
      await enqueueHubEval(sql, queue, skill.id, `manual:${actor.organizationId}`);
    }
    if (!skill.safety || skill.safety.status === "unavailable") {
      await queue.enqueue({ organizationId: null, repositoryId: null, kind: "hub_safety", dedupeKey: "pending", payload: {} });
    }
    await kickBackgroundJobs();
    return NextResponse.json({ data: { queued: true }, meta: gitMeta() }, { status: 202 });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
