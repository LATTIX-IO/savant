import { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } from "@/server/control-plane/database";
import { handleSkillIntelligenceRoute, jsonCollection } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime, isAuthorizedWorkerRequest } from "@/server/skill-intelligence/runtime";
import { runIntelligenceSweep, SkillIntelligenceError } from "@/server/skill-intelligence/service";

/**
 * Scheduled sweep (cron or worker): snapshot skill health, auto-enqueue
 * optimization where each tenant's auto-optimization mode permits it, and purge
 * telemetry past retention. Body `{ organizationId }` limits it to one tenant.
 */
export async function POST(request: Request) {
  return handleSkillIntelligenceRoute(async () => {
    if (!isAuthorizedWorkerRequest(request)) {
      throw new SkillIntelligenceError("worker_unauthorized", "A valid worker token is required.", 401);
    }

    let organizationIds: string[] = [];
    try {
      const body: unknown = await request.json();
      const organizationId = (body as { organizationId?: unknown } | null)?.organizationId;
      if (typeof organizationId === "string" && organizationId.trim()) {
        organizationIds = [organizationId.trim()];
      }
    } catch {
      // No body: sweep every tenant.
    }

    if (organizationIds.length === 0 && isControlPlaneDatabaseConfigured) {
      const rows = await getControlPlaneDatabase()<{ id: string }[]>`select id from organizations order by created_at asc`;
      organizationIds = rows.map((row) => row.id);
    }

    const deps = createSkillIntelligenceRuntime(null);
    const results = [];
    for (const organizationId of organizationIds) {
      results.push({ organizationId, ...(await runIntelligenceSweep(deps, { organizationId })) });
    }
    return jsonCollection(results);
  });
}
