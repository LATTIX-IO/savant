import type { SkillRunIngestResult } from "@savant/types";

import { authorizeIngestRequest } from "@/server/skill-intelligence/ingest-auth";
import { handleSkillIntelligenceRoute, jsonCollection, jsonResource, readJsonBody } from "@/server/skill-intelligence/route-helpers";
import { createSkillIntelligenceRuntime } from "@/server/skill-intelligence/runtime";
import { ingestSkillRun, SkillIntelligenceError } from "@/server/skill-intelligence/service";

const MAX_BATCH = 100;

/**
 * Ingest one run (`{ runId, ... }`) or a batch (`{ runs: [...] }`).
 * Payloads are validated, downgraded to the tenant capture mode, redacted,
 * and encrypted before anything is persisted.
 */
export async function POST(request: Request) {
  return handleSkillIntelligenceRoute(async () => {
    const deps = createSkillIntelligenceRuntime(null);
    const principal = await authorizeIngestRequest(request, deps.store);
    const body = await readJsonBody(request);

    const batch = typeof body === "object" && body !== null && Array.isArray((body as { runs?: unknown }).runs)
      ? (body as { runs: unknown[] }).runs
      : null;

    if (batch) {
      if (batch.length > MAX_BATCH) {
        throw new SkillIntelligenceError("batch_too_large", `A batch may contain at most ${MAX_BATCH} runs.`, 413);
      }
      const results: SkillRunIngestResult[] = [];
      for (const entry of batch) {
        results.push(await ingestSkillRun(deps, {
          organizationId: principal.organizationId,
          body: entry,
          tokenConnectorId: principal.connectorId,
        }));
      }
      return jsonCollection(results);
    }

    const result = await ingestSkillRun(deps, {
      organizationId: principal.organizationId,
      body,
      tokenConnectorId: principal.connectorId,
    });
    return jsonResource(result, result.accepted ? 201 : 200);
  });
}
