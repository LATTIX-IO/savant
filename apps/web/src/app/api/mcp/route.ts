import { handleMcpHttp, mcpMethodNotAllowed, mcpOptions } from "@/server/router/http";

export const maxDuration = 60;

/** Savant skill router (MCP over Streamable HTTP). Authorization: Bearer svt_… */
export async function POST(request: Request) {
  const header = request.headers.get("authorization") ?? "";
  return handleMcpHttp(request, header.startsWith("Bearer ") ? header.slice(7).trim() : null);
}

export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
export const OPTIONS = mcpOptions;
