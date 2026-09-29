import type { OptimizationJobResult } from "@savant/types";

import { handleSkillIntelligenceRoute, jsonResource, readJsonBody } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime, isAuthorizedWorkerRequest } from "@/server/skill-intelligence/runtime";
import { SkillIntelligenceError, submitOptimizationResult } from "@/server/skill-intelligence/service";

const MAX_RESULT_BYTES = 2_000_000;

/**
 * Worker submits a candidate plus raw paired case results. The control plane
 * re-derives edits, re-checks locks and the change budget, and recomputes the
 * gate and bootstrap interval itself — the worker's verdict is never trusted.
 */
export async function POST(request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    if (!isAuthorizedWorkerRequest(request)) {
      throw new SkillIntelligenceError("worker_unauthorized", "A valid worker token is required.", 401);
    }
    const length = Number(request.headers.get("content-length") ?? "0");
    if (length > MAX_RESULT_BYTES) {
      throw new SkillIntelligenceError("result_too_large", "Optimization result exceeds the maximum size.", 413);
    }

    const { jobId } = await params;
    const body = await readJsonBody(request);
    if (typeof body !== "object" || body === null || (body as { schemaVersion?: unknown }).schemaVersion !== 1) {
      throw new SkillIntelligenceError("invalid_result", "Expected an OptimizationJobResult with schemaVersion 1.", 400);
    }

    return jsonResource(await submitOptimizationResult(createSkillIntelligenceRuntime(null), {
      jobId,
      result: body as OptimizationJobResult,
    }));
  });
}
