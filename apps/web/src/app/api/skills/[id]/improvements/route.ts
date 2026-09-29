import type { OptimizationAggressiveness, OptimizationTriggerRequest } from "@savant/types";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { requireReviewer, resolveIntelligenceActor } from "@/server/skill-intelligence/actors";
import { handleSkillIntelligenceRoute, jsonCollection, jsonResource } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime, ensureDevelopmentFixtures } from "@/server/skill-intelligence/runtime";
import { listSkillRecommendations, requestOptimization } from "@/server/skill-intelligence/service";

const AGGRESSIVENESS: readonly OptimizationAggressiveness[] = ["conservative", "balanced", "exploratory"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    const context = await authorizeTenantRequest(request);
    const deps = createSkillIntelligenceRuntime(context);
    await ensureDevelopmentFixtures(deps, context.tenant.organizationId);
    const { id } = await params;
    return jsonCollection(await listSkillRecommendations(deps, {
      organizationId: context.tenant.organizationId,
      skillIdentifier: id,
    }));
  });
}

/** "Analyze for Improvements": queue a bounded SkillOpt optimization job for this skill. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const deps = createSkillIntelligenceRuntime(context);
    const { id } = await params;
    const skill = await deps.catalog.getSkill(context.tenant.organizationId, id);
    const actor = await resolveIntelligenceActor(context);
    requireReviewer(actor, skill?.owner ?? null, { isDevelopmentFallback: context.isDevelopmentFallback });

    let body: Record<string, unknown> = {};
    try {
      const parsed: unknown = await request.json();
      if (typeof parsed === "object" && parsed !== null) {
        body = parsed as Record<string, unknown>;
      }
    } catch {
      // An empty body means "use workspace defaults".
    }

    const triggerRequest: OptimizationTriggerRequest = { trigger: "manual" };
    if (typeof body.aggressiveness === "string" && AGGRESSIVENESS.includes(body.aggressiveness as OptimizationAggressiveness)) {
      triggerRequest.aggressiveness = body.aggressiveness as OptimizationAggressiveness;
    }
    if (typeof body.objective === "string" && body.objective.trim().length > 0) {
      triggerRequest.objective = body.objective.trim().slice(0, 500);
    }

    const job = await requestOptimization(deps, {
      organizationId: context.tenant.organizationId,
      skillIdentifier: id,
      request: triggerRequest,
      actor: { subject: actor.subject, userId: actor.userId },
    });
    return jsonResource(job, 202);
  });
}
