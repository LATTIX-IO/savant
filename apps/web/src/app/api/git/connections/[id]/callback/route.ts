import { after, NextResponse } from "next/server";

import { auth0 } from "@/lib/auth0";
import { resolveGitActor } from "@/server/git/access-control";
import { GitProviderError } from "@/server/git/errors";
import { logGitEvent } from "@/server/git/redaction";
import { createAfterResponseIndexScheduler, getGitRuntime } from "@/server/git/runtime";
import { isGitProviderType } from "@/server/git/types";

export const maxDuration = 300;

function redirectTo(request: Request, path: string, params: Record<string, string>): NextResponse {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // Same-origin only; the path was sanitized when the state was created.
  const response = NextResponse.redirect(new URL(`${url.pathname}${url.search}`, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/**
 * Provider OAuth / GitHub App installation callback. The `[id]` segment is the
 * provider type. The organization is taken only from the single-use state,
 * which must have been created by the same signed-in Savant user.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/git/connections/[id]/callback">) {
  const { id: provider } = await ctx.params;
  const url = new URL(request.url);

  try {
    if (!isGitProviderType(provider)) {
      throw new GitProviderError("INVALID_REQUEST", "Unknown provider.");
    }

    const session = auth0 ? await auth0.getSession() : null;
    const runtime = await getGitRuntime();
    const completed = await runtime.connections.completeAuthorization({
      provider,
      query: url.searchParams,
      userSubject: session?.user?.sub ?? null,
      verifyActor: (organizationId, subject) => resolveGitActor(runtime.membership, { organizationId, subject }),
    });

    if (completed.repositoryIdsToSync.length > 0) {
      const scheduler = createAfterResponseIndexScheduler(after);
      for (const repositoryId of completed.repositoryIdsToSync) {
        await scheduler.enqueue({
          organizationId: completed.organizationId,
          repositoryId,
          connectionId: completed.connection.id,
          trigger: "reconciliation",
          actorSubject: completed.actorSubject,
        });
      }
    }

    return redirectTo(request, completed.returnPath, {
      git_status: completed.created ? "connected" : "reauthorized",
      git_connection: completed.connection.id,
      ...(completed.repositoryIdsToSync.length > 0 ? { git_resyncing: String(completed.repositoryIdsToSync.length) } : {}),
    });
  } catch (error) {
    const code = error instanceof GitProviderError ? error.code : "INDEX_FAILED";
    logGitEvent("warn", "authorization_callback_failed", { provider, error_code: code, error });
    // Only the standardized code travels in the URL — never provider messages or parameters.
    return redirectTo(request, "/settings", { section: "source-control", git_error: code, git_provider: isGitProviderType(provider) ? provider : "" });
  }
}
