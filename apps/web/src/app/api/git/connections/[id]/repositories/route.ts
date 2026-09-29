import { NextResponse } from "next/server";

import type { GitDiscoveredRepositoryListResponse } from "@savant/types";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

/** Server-side paginated repository discovery for one connection. */
export async function GET(request: Request, ctx: RouteContext<"/api/git/connections/[id]/repositories">) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const runtime = await getGitRuntime();
    const page = await runtime.connections.listDiscoveredRepositories(actor, id, {
      cursor: searchParams.get("cursor")?.slice(0, 2000) || undefined,
      search: searchParams.get("search") ?? undefined,
    });
    const response: GitDiscoveredRepositoryListResponse = {
      data: page.items,
      meta: { ...gitMeta(), nextCursor: page.nextCursor, count: page.items.length },
    };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}
