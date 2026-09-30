import { NextResponse } from "next/server";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";
import { GitProviderError } from "@/server/git/errors";
import { proposeCatalogImport } from "@/server/hub/import";

export const maxDuration = 120;

/** Proposes importing a catalog skill into one of the tenant's connected repositories (approval opens a pull request). */
export async function POST(request: Request, ctx: RouteContext<"/api/catalog/[id]/import">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const body = await readJsonBody(request);
    const repositoryId = readOptionalString(body, "repositoryId", 64);
    if (!repositoryId) {
      throw new GitProviderError("INVALID_REQUEST", "Choose a repository to import into.");
    }
    const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
    const result = await proposeCatalogImport(getControlPlaneDatabase(), await getGitRuntime(), actor, {
      hubSkillId: id,
      repositoryId,
      targetRoot: readOptionalString(body, "targetRoot", 200),
      owner: readOptionalString(body, "owner", 80),
    });
    return NextResponse.json({ data: result, meta: gitMeta() }, { status: 201 });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
