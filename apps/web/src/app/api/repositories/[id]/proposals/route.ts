import { NextResponse } from "next/server";

import type { ChangeProposalResponse } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta, readJsonBody, readOptionalString } from "@/server/git/route-helpers";
import { getGitRuntime, resolveGitActorForTenant } from "@/server/git/runtime";

export const maxDuration = 120;

/**
 * Creates a change proposal, either from fixable assessment findings
 * (`{ fingerprints }`) or from explicit edits (`{ title, files }`). Nothing is
 * written to the repository until the proposal is approved.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/repositories/[id]/proposals">) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    const { id } = await ctx.params;
    const body = await readJsonBody(request);
    const runtime = await getGitRuntime();
    let proposal;

    if (Array.isArray(body.fingerprints)) {
      const fingerprints = body.fingerprints.filter((value): value is string => typeof value === "string" && value.length <= 64).slice(0, 200);
      proposal = await runtime.assessments.proposeFixes(actor, id, fingerprints);
    } else if (Array.isArray(body.files)) {
      const files = body.files
        .filter((file): file is Record<string, unknown> => typeof file === "object" && file !== null)
        .map((file) => ({ path: typeof file.path === "string" ? file.path.trim() : "", content: typeof file.content === "string" ? file.content : "" }));
      proposal = await runtime.assessments.proposeFileEdits(actor, id, {
        title: readOptionalString(body, "title", 200) ?? "Savant: update skill files",
        body: readOptionalString(body, "body", 5000),
        files,
      });
    } else {
      throw new GitProviderError("INVALID_REQUEST", "Provide fingerprints (fix findings) or files (explicit edits).");
    }

    const response: ChangeProposalResponse = { data: proposal, meta: gitMeta() };
    return NextResponse.json(response, { status: 201 });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
