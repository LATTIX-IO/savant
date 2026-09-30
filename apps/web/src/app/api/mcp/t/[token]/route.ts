import { handleMcpHttp, mcpMethodNotAllowed, mcpOptions } from "@/server/router/http";

export const maxDuration = 60;

/** Savant skill router with the token in the URL, for connector UIs that only take a URL (claude.ai, ChatGPT). */
export async function POST(request: Request, ctx: RouteContext<"/api/mcp/t/[token]">) {
  const { token } = await ctx.params;
  return handleMcpHttp(request, decodeURIComponent(token));
}

export const GET = mcpMethodNotAllowed;
export const DELETE = mcpMethodNotAllowed;
export const OPTIONS = mcpOptions;
