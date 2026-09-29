import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { requireAdmin, resolveIntelligenceActor } from "@/server/skill-intelligence/actors";
import { handleSkillIntelligenceRoute, jsonResource, readJsonBody } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { updateIntelligenceSettings } from "@/server/skill-intelligence/service";

export async function GET(request: Request) {
  return handleSkillIntelligenceRoute(async () => {
    const context = await authorizeTenantRequest(request);
    const deps = createSkillIntelligenceRuntime(context);
    return jsonResource(await deps.store.getSettings(context.tenant.organizationId));
  });
}

/** Telemetry capture mode, retention, auto-optimization mode, thresholds, and optimizer providers. */
export async function PUT(request: Request) {
  return handleSkillIntelligenceRoute(async () => {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveIntelligenceActor(context);
    requireAdmin(actor, "change Skill Intelligence settings");
    const deps = createSkillIntelligenceRuntime(context);
    return jsonResource(await updateIntelligenceSettings(deps, {
      organizationId: context.tenant.organizationId,
      body: await readJsonBody(request),
      actor: { subject: actor.subject, userId: actor.userId },
    }));
  });
}
