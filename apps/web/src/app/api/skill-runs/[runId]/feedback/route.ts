import { authorizeIngestRequest } from "@/server/skill-intelligence/ingest-auth";
import { handleSkillIntelligenceRoute, jsonResource, readJsonBody } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { recordSkillFeedback } from "@/server/skill-intelligence/service";

/** Passive signals (accepted, regenerated, discarded, …) and explicit feedback for a run. */
export async function POST(request: Request, { params }: { params: Promise<{ runId: string }> }) {
  return handleSkillIntelligenceRoute(async () => {
    const deps = createSkillIntelligenceRuntime(null);
    const principal = await authorizeIngestRequest(request, deps.store);
    const { runId } = await params;
    const record = await recordSkillFeedback(deps, {
      organizationId: principal.organizationId,
      runId,
      body: await readJsonBody(request),
    });
    return jsonResource(record, 201);
  });
}
