import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { requireReviewer, resolveIntelligenceActor } from "@/server/skill-intelligence/actors";
import { handleSkillIntelligenceRoute, jsonResource } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { getRecommendation, requestReevaluation } from "@/server/skill-intelligence/service";

/** Re-queue evaluation for a recommendation awaiting it (e.g. after a manual edit). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const deps = createSkillIntelligenceRuntime(context);
    const { id } = await params;
    const recommendation = await getRecommendation(deps, { organizationId: context.tenant.organizationId, recommendationId: id });
    const skill = await deps.catalog.getSkill(context.tenant.organizationId, recommendation.skillId);
    const actor = await resolveIntelligenceActor(context);
    requireReviewer(actor, skill?.owner ?? null, { isDevelopmentFallback: context.isDevelopmentFallback });
    return jsonResource(await requestReevaluation(deps, {
      organizationId: context.tenant.organizationId,
      recommendationId: id,
      actor: { subject: actor.subject, userId: actor.userId },
    }), 202);
  });
}
