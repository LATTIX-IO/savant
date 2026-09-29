import { after, NextResponse } from "next/server";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { createAfterResponseIndexScheduler, getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

export const maxDuration = 300;

/**
 * Explicitly chooses which provider connection reads a repository — the
 * resolution for CONNECTION_AMBIGUOUS — then starts a sync.
 */
export async function PUT(request: Request, ctx: RouteContext<"/api/repositories/[id]/connection">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const body = await readJsonBody(request);
    const connectionId = readOptionalString(body, "connectionId", 64);

    if (!connectionId) {
      throw new GitProviderError("INVALID_REQUEST", "connectionId is required.");
    }

    const runtime = await getGitRuntime();
    await runtime.connections.assignRepositoryConnection(actor, id, connectionId);
    const indexing = await createAfterResponseIndexScheduler(after).enqueue({
      organizationId: actor.organizationId,
      repositoryId: id,
      connectionId,
      trigger: "manual",
      actorSubject: actor.subject,
    });

    return NextResponse.json({ data: { repositoryId: id, connectionId, indexing }, meta: gitMeta() });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
