import { after, NextResponse } from "next/server";

import { runAndContinue } from "@/server/jobs/runner";
import { isAuthorizedWorker } from "@/server/jobs/worker-auth";

export const maxDuration = 300;

/**
 * Processes queued background jobs (tenant safety scans and evaluation
 * generation; catalog sync, scans and live evaluations). Responds at once and
 * works after the response, handing any remaining queue to a fresh invocation.
 * Called by Vercel Cron (CRON_SECRET), external workers (SAVANT_WORKER_TOKEN)
 * and the runner itself (internal token).
 */
async function handle(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "A worker token is required." } }, { status: 401 });
  }
  const depth = Math.max(0, Number(request.headers.get("x-savant-chain")) || 0);
  after(async () => {
    await runAndContinue(depth);
  });
  return NextResponse.json({ data: { accepted: true, chain: depth } }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
