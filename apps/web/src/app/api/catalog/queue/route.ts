import { NextResponse } from "next/server";

import { authorizeTenantRequest } from "@/server/control-plane/tenant-context";
import { assertGitPermission } from "@/server/git/access-control";
import { gitErrorResponse, gitMeta } from "@/server/git/route-helpers";
import { resolveGitActorForTenant } from "@/server/git/runtime";
import { internalWorkerToken, selfBaseUrl } from "@/server/jobs/worker-auth";

/** Background queue health for platform (catalog) jobs and this workspace's jobs. Admins only. */
export async function GET(request: Request) {
  try {
    const context = await authorizeTenantRequest(request);
    const actor = await resolveGitActorForTenant(context);
    assertGitPermission(actor, "connect_provider");
    const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
    const sql = getControlPlaneDatabase();
    const [counts, recent] = await Promise.all([
      sql<{ kind: string; status: string; count: number }[]>`
        select kind, status, count(*)::int as count from background_jobs
        where organization_id is null or organization_id = ${actor.organizationId}
        group by kind, status order by kind, status
      `,
      sql<{ kind: string; status: string; attempts: number; error: string | null; updated_at: Date; lease_until: Date | null; progress: unknown }[]>`
        select kind, status, attempts, error, updated_at, lease_until, progress from background_jobs
        where organization_id is null or organization_id = ${actor.organizationId}
        order by updated_at desc limit 15
      `,
    ]);
    return NextResponse.json({
      data: {
        counts,
        recent,
        runner: { baseUrl: selfBaseUrl(), internalToken: Boolean(internalWorkerToken()), workerToken: Boolean(process.env.SAVANT_WORKER_TOKEN), cronSecret: Boolean(process.env.CRON_SECRET) },
      },
      meta: gitMeta(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return gitErrorResponse(error);
  }
}
