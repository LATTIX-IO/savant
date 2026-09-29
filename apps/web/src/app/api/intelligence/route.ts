import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { handleSkillIntelligenceRoute, jsonResource } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime, ensureDevelopmentFixtures } from "@/server/skill-intelligence/runtime";
import { getOrganizationIntelligence } from "@/server/skill-intelligence/service";

/** Organizational capability dashboard + improvement queue (impact × confidence × usage). */
export async function GET(request: Request) {
  return handleSkillIntelligenceRoute(async () => {
    const context = await authorizeTenantRequest(request);
    const deps = createSkillIntelligenceRuntime(context);
    await ensureDevelopmentFixtures(deps, context.tenant.organizationId);
    return jsonResource(await getOrganizationIntelligence(deps, { organizationId: context.tenant.organizationId }));
  });
}
