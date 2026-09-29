import { handleSkillIntelligenceRoute, jsonResource } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime, isAuthorizedWorkerRequest } from "@/server/skill-intelligence/runtime";
import { claimOptimizationJob, SkillIntelligenceError } from "@/server/skill-intelligence/service";

/**
 * Worker endpoint. The Skill Intelligence worker holds no database
 * credentials; it leases one job at a time and receives a sanitized,
 * tenant-scoped bundle. Returns `{ data: null }` when the queue is empty.
 */
export async function POST(request: Request) {
  return handleSkillIntelligenceRoute(async () => {
    if (!isAuthorizedWorkerRequest(request)) {
      throw new SkillIntelligenceError("worker_unauthorized", "A valid worker token is required.", 401);
    }
    return jsonResource(await claimOptimizationJob(createSkillIntelligenceRuntime(null)));
  });
}
