import { NextResponse } from "next/server";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { createApiErrorResponse } from "@/server/control-plane/control-plane-response";
import { tryRecordAuditEvent } from "@/server/control-plane/audit-events";
import { readWorkflowRequestObject } from "@/server/workflows/request";
import { capabilityResolver } from "@/server/workflows/capability-resolver-runtime";
import { createCapabilityLinkService } from "@/server/workflows/capability-links";
import { CapabilityResolveError } from "@/server/workflows/capability-resolver";

export const dynamic = "force-dynamic";
const links = createCapabilityLinkService(capabilityResolver);

export async function POST(request: Request) {
  let tenant: Awaited<ReturnType<typeof authorizeTenantRequest>> | undefined;
  try {
    tenant = await authorizeTenantRequest(request);
    if (!tenant.identity || tenant.isDevelopmentFallback)
      throw new CapabilityResolveError("auth_required", 401);
    const body = await readWorkflowRequestObject(request);
    const result = await links.resolve({
      organizationId: tenant.tenant.organizationId,
      subject: tenant.identity.subject,
    }, body);
    await tryRecordAuditEvent({
      organizationId: tenant.tenant.organizationId,
      actorSubject: tenant.identity.subject,
      category: "repo", action: "capability_links_verified",
      targetType: "capability", targetRef: "batch",
      payload: { linkCount: result.links.length, nodeCount: result.nodeCount },
    }).catch(() => undefined);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const known = error instanceof CapabilityResolveError || error instanceof TenantContextError;
    const code = known ? error.code : "capability_links_unavailable";
    const status = known ? error.status : 503;
    if (tenant?.identity) {
      await tryRecordAuditEvent({
        organizationId: tenant.tenant.organizationId,
        actorSubject: tenant.identity.subject,
        category: "repo", action: "capability_links_denied",
        targetType: "capability", targetRef: "redacted",
        payload: { code },
      }).catch(() => undefined);
    }
    return NextResponse.json(createApiErrorResponse(code, code),
      { status, headers: { "Cache-Control": "no-store" } });
  }
}
