import { NextResponse } from "next/server";

import { assertSameOriginMutationRequest } from "@/server/control-plane/request-security";
import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { assertGitPermission } from "@/server/git/access-control";
import { GitProviderError } from "@/server/git/errors";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";
import { enqueueHubSync } from "@/server/hub/jobs";
import { createHubStore } from "@/server/hub/store";
import { createJobQueue } from "@/server/jobs/queue";
import { kickBackgroundJobs } from "@/server/jobs/runner";

export const maxDuration = 300;

const MIN_INTERVAL_MS = 30 * 60 * 1000;

/** Refreshes the platform catalog from its sources now (workspace admins; at most every 30 minutes). */
export async function POST(request: Request) {
  try {
    assertSameOriginMutationRequest(request);
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    assertGitPermission(actor, "connect_provider");
    const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
    const sql = getControlPlaneDatabase();
    const sources = (await createHubStore(sql).listSources()).filter((source) => source.enabled);
    const latest = Math.max(0, ...sources.map((source) => (source.lastSyncedAt ? Date.parse(source.lastSyncedAt) : 0)));
    if (Date.now() - latest < MIN_INTERVAL_MS) {
      throw new GitProviderError("INVALID_REQUEST", "The catalog was refreshed less than 30 minutes ago.", { status: 429 });
    }
    await enqueueHubSync(createJobQueue(sql), sources.map((source) => source.id));
    await kickBackgroundJobs();
    return NextResponse.json({ data: { queued: sources.map((source) => source.id) }, meta: gitMeta() }, { status: 202 });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
