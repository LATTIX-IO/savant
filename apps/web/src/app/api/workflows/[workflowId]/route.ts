import { NextResponse } from "next/server";

import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { readWorkflowRequestObject } from "@/server/workflows/request";
import { GitProviderError } from "@/server/git/errors";
import { workflowArtifacts } from "@/server/workflows/runtime";
import { WorkflowArtifactError } from "@/server/workflows/workflow-artifacts";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ workflowId: string }> };

function responseForError(error: unknown): NextResponse | null {
  if (error instanceof WorkflowArtifactError || error instanceof TenantContextError) {
    return NextResponse.json(createApiErrorResponse(error.code, error.message), { status: error.status });
  }
  if (error instanceof GitProviderError) {
    return NextResponse.json(
      createApiErrorResponse("git_connection_unavailable", "The authorized repository connection is unavailable."),
      { status: error.status === 404 ? 404 : error.status === 403 ? 403 : 503 },
    );
  }
  return null;
}
export async function GET(request: Request, context: Params) {
  try {
    const tenant = await authorizeTenantRequest(request);
    const { workflowId } = await context.params;
    const url = new URL(request.url);
    const repositoryId = url.searchParams.get("repositoryId") ?? "";
    const revision = url.searchParams.get("revision") ?? undefined;
    const result = await workflowArtifacts.get({
      organizationId: tenant.tenant.organizationId,
      actor: tenant.identity?.subject ?? "",
    }, repositoryId, workflowId, revision);
    return NextResponse.json({ data: result }, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const handled = responseForError(error);
    if (handled) return handled;
    throw error;
  }
}
export async function PUT(request: Request, context: Params) {
  try {
    const tenant = await authorizeTenantRequest(request);
    const body = await readWorkflowRequestObject(request);
    if (!body) return NextResponse.json(createApiErrorResponse("invalid_json_body", "Expected a JSON object."), { status: 400 });
    const { workflowId } = await context.params;
    const expected = body.expectedBlobSha;
    const result = await workflowArtifacts.save({
      organizationId: tenant.tenant.organizationId,
      actor: tenant.identity?.subject ?? "",
    }, typeof body.repositoryId === "string" ? body.repositoryId : "",
    workflowId, body.specification, expected === null || typeof expected === "string" ? expected : undefined);
    return NextResponse.json({ data: result }, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const handled = responseForError(error);
    if (handled) return handled;
    throw error;
  }
}
