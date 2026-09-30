import { NextResponse } from "next/server";

import { createSkillIntelligenceRuntime } from "../skill-intelligence/runtime.ts";
import { hashLeaseToken, ingestSkillRun, recordSkillFeedback, recordSkillOutcome } from "../skill-intelligence/service.ts";
import { decodeSession, handleMcpMessage, type TelemetrySink } from "./mcp.ts";
import type { RouterPrincipal } from "./router.ts";

/**
 * HTTP transport for the skill router (MCP Streamable HTTP, stateless JSON
 * responses). Authenticates with a workspace telemetry token (`svt_…`), sent
 * as a Bearer header or embedded in the URL for clients whose connector UI
 * only accepts a URL (claude.ai, ChatGPT).
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version, x-savant-runtime",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

function createTelemetry(): TelemetrySink {
  const deps = createSkillIntelligenceRuntime(null);
  return {
    async startRun({ principal, client, skill, runId, task }) {
      const result = await ingestSkillRun(deps, {
        organizationId: principal.organizationId,
        tokenConnectorId: principal.connectorId,
        body: {
          runId,
          skillId: skill.skillId,
          skillVersionId: skill.version,
          connectorId: principal.connectorId ?? `savant-router:${client.runtime}`,
          runtime: client.runtime,
          telemetryLevel: task ? "io" : "outcome",
          startedAt: new Date().toISOString(),
          taskArchetype: "skill-router",
          ...(client.name ? { model: `${client.name}${client.version ? ` ${client.version}` : ""}`.slice(0, 120) } : {}),
          ...(task ? { input: task } : {}),
        },
      });
      return { accepted: result.accepted, reason: result.reason };
    },
    async finishRun({ principal, runId, outcome, accepted, rating, notes }) {
      await recordSkillOutcome(deps, {
        organizationId: principal.organizationId,
        runId,
        body: { taskOutcome: outcome, ...(accepted === null ? {} : { humanAccepted: accepted }), outcomeLabel: "skill-router" },
      });
      if (rating !== null) {
        await recordSkillFeedback(deps, {
          organizationId: principal.organizationId,
          runId,
          reporterRole: "user",
          body: { kind: "explicit", rating, ...(notes ? { comment: notes } : {}) },
        }).catch(() => undefined);
      }
    },
  };
}

async function resolvePrincipal(token: string | null): Promise<RouterPrincipal | null> {
  if (!token?.startsWith("svt_")) return null;
  const deps = createSkillIntelligenceRuntime(null);
  const resolved = await deps.store.resolveIngestToken(hashLeaseToken(token));
  return resolved ? { organizationId: resolved.organizationId, connectorId: resolved.connectorId } : null;
}

export function mcpOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export function mcpMethodNotAllowed(): NextResponse {
  // Stateless server: no server-initiated SSE stream and no sessions to delete.
  return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Use POST for MCP requests." } }, { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } });
}

export async function handleMcpHttp(request: Request, token: string | null): Promise<NextResponse> {
  const principal = await resolvePrincipal(token);
  if (!principal) {
    return NextResponse.json(
      { jsonrpc: "2.0", id: null, error: { code: -32001, message: "A valid Savant telemetry token (svt_…) is required. Create one in Savant → Distribution → AI tool connections." } },
      { status: 401, headers: CORS },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400, headers: CORS });
  }

  const { getControlPlaneDatabase } = await import("../control-plane/database.ts");
  const deps = { sql: getControlPlaneDatabase(), telemetry: createTelemetry() };
  const session = decodeSession(request.headers.get("mcp-session-id"));
  const hints = { runtime: request.headers.get("x-savant-runtime") ?? new URL(request.url).searchParams.get("runtime") };
  const messages = Array.isArray(body) ? body : [body];
  const responses = [];
  let newSession: string | undefined;
  for (const message of messages) {
    const handled = await handleMcpMessage(deps, principal, session, (message ?? {}) as Record<string, never>, hints);
    if (handled.session) newSession = handled.session;
    if (handled.response) responses.push(handled.response);
  }

  const headers: Record<string, string> = { ...CORS, "Cache-Control": "no-store" };
  if (newSession) headers["Mcp-Session-Id"] = newSession;
  if (responses.length === 0) {
    return new NextResponse(null, { status: 202, headers });
  }
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], { headers });
}
