import "server-only";

import { assertSameOriginMutationRequest } from "../control-plane/request-security.ts";
import { authorizeTenantRequest } from "../control-plane/tenant-context.ts";

import { hashLeaseToken, SkillIntelligenceError } from "./service.ts";
import { readBearerToken } from "./runtime.ts";
import type { SkillIntelligenceStore } from "./store.ts";

export type IngestPrincipal = {
  organizationId: string;
  /** Token-scoped connector, when the token was minted for one. */
  connectorId: string | null;
  via: "token" | "session";
};

/**
 * Telemetry arrives either from instrumented runtimes holding a tenant-scoped
 * `svt_` ingest token, or from the Savant UI itself (session + same origin).
 */
export async function authorizeIngestRequest(request: Request, store: SkillIntelligenceStore): Promise<IngestPrincipal> {
  const bearer = readBearerToken(request);
  if (bearer?.startsWith("svt_")) {
    const resolved = await store.resolveIngestToken(hashLeaseToken(bearer));
    if (!resolved) {
      throw new SkillIntelligenceError("ingest_token_invalid", "The telemetry ingest token is invalid or revoked.", 401);
    }
    return { organizationId: resolved.organizationId, connectorId: resolved.connectorId, via: "token" };
  }

  assertSameOriginMutationRequest(request);
  const context = await authorizeTenantRequest(request);
  return { organizationId: context.tenant.organizationId, connectorId: null, via: "session" };
}
