import { NextResponse } from "next/server";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

/** Dismisses (or restores) a finding; dismissals persist across syncs by fingerprint. */
export async function POST(request: Request, ctx: RouteContext<"/api/repositories/[id]/assessment/dismissals">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const body = await readJsonBody(request);
    const fingerprint = readOptionalString(body, "fingerprint", 64);
    if (!fingerprint) {
      throw new GitProviderError("INVALID_REQUEST", "fingerprint is required.");
    }
    const runtime = await getGitRuntime();
    await runtime.assessments.setFindingDismissed(actor, id, fingerprint, body.dismissed !== false, readOptionalString(body, "reason", 500));
    return NextResponse.json({ data: { fingerprint, dismissed: body.dismissed !== false }, meta: gitMeta() });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
