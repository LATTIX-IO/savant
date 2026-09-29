import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { requireAdmin, resolveIntelligenceActor } from "@/server/skill-intelligence/actors";
import { handleSkillIntelligenceRoute, jsonResource } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { getRecommendation, stageApprovedRecommendation } from "@/server/skill-intelligence/service";

/** Write an approved candidate to Git as a new version and open a draft → staging release. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveIntelligenceActor(context);
    requireAdmin(actor, "stage approved skill improvements");
    const deps = createSkillIntelligenceRuntime(context);
    const { id } = await params;
    const recommendation = await getRecommendation(deps, { organizationId: context.tenant.organizationId, recommendationId: id });
    return jsonResource(await stageApprovedRecommendation(deps, {
      organizationId: context.tenant.organizationId,
      recommendation,
      actor: { subject: actor.subject, userId: actor.userId },
    }));
  });
}
