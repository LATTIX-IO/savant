import { after, NextResponse } from "next/server";

import type { GitConnectionListResponse, GitManualTokenConnectResponse } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { createAfterResponseIndexScheduler, getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";
import { isGitProviderType } from "@/server/git/types";

export async function GET(request: Request) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const runtime = await getGitRuntime();
    const data = await runtime.connections.listConnections(actor);
    const response: GitConnectionListResponse = { data, meta: { ...gitMeta(), count: data.length } };
    return NextResponse.json(response);
  } catch (error) {
    return gitErrorResponse(error);
  }
}

/** Advanced: connect using an access token. The token is validated, encrypted, and never returned. */
export async function POST(request: Request) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const body = await readJsonBody(request);
    const provider = readOptionalString(body, "provider", 20);
    const token = typeof body.token === "string" ? body.token : "";

    if (!provider || !isGitProviderType(provider) || !token) {
      throw new GitProviderError("INVALID_REQUEST", "provider and token are required.");
    }

    const runtime = await getGitRuntime();
    const result = await runtime.connections.connectManualToken(actor, {
      provider,
      token,
      displayName: readOptionalString(body, "displayName", 120),
      host: readOptionalString(body, "host", 300),
      organization: readOptionalString(body, "organization", 120),
    });

    // Repositories that were waiting for this provider are indexed now.
    const scheduler = createAfterResponseIndexScheduler(after);
    const pending = await runtime.stores.repositories.listRepositoryIdsForConnection(actor.organizationId, result.connection.id);
    for (const repositoryId of pending) {
      await scheduler.enqueue({ organizationId: actor.organizationId, repositoryId, connectionId: result.connection.id, trigger: "reconciliation", actorSubject: actor.subject });
    }

    const response: GitManualTokenConnectResponse = {
      data: { connection: result.connection, message: "Credential stored securely.", warnings: result.warnings },
      meta: gitMeta(),
    };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
