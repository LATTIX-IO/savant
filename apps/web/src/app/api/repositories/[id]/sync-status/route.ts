import { NextResponse } from "next/server";

import type { RepositorySyncStatusResponse } from "@savant/types";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

/** Indexing state for a repository, separate from its provider connection state. */
export async function GET(request: Request, ctx: RouteContext<"/api/repositories/[id]/sync-status">) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const runtime = await getGitRuntime();
    const service = runtime.createRepositoryService({ enqueue: async () => ({ started: false }) });
    const response: RepositorySyncStatusResponse = { data: await service.getSyncStatus(actor, id), meta: gitMeta() };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
