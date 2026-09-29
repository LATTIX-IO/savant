import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { handleSkillIntelligenceRoute, jsonResource } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime, ensureDevelopmentFixtures } from "@/server/skill-intelligence/runtime";
import { getSkillIntelligence } from "@/server/skill-intelligence/service";

/** Health, cohorts, telemetry coverage, failure clusters, eligibility, runs, and learning history. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    const context = await authorizeTenantRequest(request);
    const deps = createSkillIntelligenceRuntime(context);
    await ensureDevelopmentFixtures(deps, context.tenant.organizationId);
    const { id } = await params;
    return jsonResource(await getSkillIntelligence(deps, {
      organizationId: context.tenant.organizationId,
      skillIdentifier: id,
    }));
  });
}
