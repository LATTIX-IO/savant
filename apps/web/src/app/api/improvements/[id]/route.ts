import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { handleSkillIntelligenceRoute, jsonResource } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { getRecommendation } from "@/server/skill-intelligence/service";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    const context = await authorizeTenantRequest(request);
    const { id } = await params;
    return jsonResource(await getRecommendation(createSkillIntelligenceRuntime(context), {
      organizationId: context.tenant.organizationId,
      recommendationId: id,
    }));
  });
}
