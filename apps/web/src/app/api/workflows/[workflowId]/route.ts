import { NextResponse } from "next/server";

import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { readWorkflowRequestObject } from "@/server/workflows/request";
import { GitProviderError } from "@/server/git/errors";
import { workflowArtifacts } from "@/server/workflows/runtime";
import { getControlPlaneDatabase } from "@/server/control-plane/database";
import { authorizeCapabilityRepository } from "@/server/workflows/capability-access";
import { authorizeCapabilityArtifact } from "@/server/workflows/capability-artifact-access";
import { CapabilityResolveError } from "@/server/workflows/capability-resolver";
import { WorkflowArtifactError } from "@/server/workflows/workflow-artifacts";

export const dynamic = "force-dynamic";
type Params = { params: Promise<{ workflowId: string }> };

function responseForError(error: unknown): NextResponse | null {
  if (error instanceof WorkflowArtifactError || error instanceof TenantContextError || error instanceof CapabilityResolveError) {
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
    const actor={organizationId:tenant.tenant.organizationId,subject:tenant.identity?.subject??""};
    // The repository is tenant-owned, but workspace membership alone never
    // supersedes explicit repo/artifact read-deny rules.
    const sql=getControlPlaneDatabase();
    await authorizeCapabilityRepository(sql,actor,repositoryId);
    await authorizeCapabilityArtifact(sql,actor,{
      organizationId:actor.organizationId,repositoryId,kind:"workflow_spec",artifactId:workflowId,
    });
    const result = await workflowArtifacts.get({
      organizationId: actor.organizationId,
      actor: actor.subject,
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
    const repositoryId=typeof body.repositoryId==="string"?body.repositoryId:"";
    const actor={organizationId:tenant.tenant.organizationId,subject:tenant.identity?.subject??""};
    // The owner write grant does not bypass an explicit artifact read denial.
    const sql=getControlPlaneDatabase();
    await authorizeCapabilityRepository(sql,actor,repositoryId);
    await authorizeCapabilityArtifact(sql,actor,{
      organizationId:actor.organizationId,repositoryId,kind:"workflow_spec",artifactId:workflowId,
    });
    const result = await workflowArtifacts.save({
      organizationId: actor.organizationId,
      actor: actor.subject,
    }, repositoryId,
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
