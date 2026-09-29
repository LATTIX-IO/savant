import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { requireAdmin, resolveIntelligenceActor } from "@/server/skill-intelligence/actors";
import { handleSkillIntelligenceRoute, jsonResource, readJsonBody } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { createIngestToken, SkillIntelligenceError } from "@/server/skill-intelligence/service";

/** Mint a tenant-scoped telemetry ingest token. The token is returned once; only its hash is stored. */
export async function POST(request: Request) {
  return handleSkillIntelligenceRoute(async () => {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveIntelligenceActor(context);
    requireAdmin(actor, "create telemetry ingest tokens");

    const raw = await readJsonBody(request);
    const body = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : {};
    const label = typeof body.label === "string" ? body.label.trim().slice(0, 120) : "";
    if (!label) {
      throw new SkillIntelligenceError("label_required", "A label is required for the ingest token.", 400);
    }
    const connectorId = typeof body.connectorId === "string" && body.connectorId.trim()
      ? body.connectorId.trim().slice(0, 200)
      : null;

    const deps = createSkillIntelligenceRuntime(context);
    return jsonResource(await createIngestToken(deps, {
      organizationId: context.tenant.organizationId,
      label,
      connectorId,
      actor: { subject: actor.subject, userId: actor.userId },
    }), 201);
  });
}
