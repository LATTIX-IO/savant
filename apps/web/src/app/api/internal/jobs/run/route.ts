import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { runBackgroundJobs } from "@/server/jobs/runner";

export const maxDuration = 300;

function authorized(request: Request): boolean {
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  return [process.env.SAVANT_WORKER_TOKEN, process.env.CRON_SECRET].some((secret) => {
    if (!secret || secret.length < 16 || presented.length !== secret.length) return false;
    return timingSafeEqual(Buffer.from(presented), Buffer.from(secret));
  });
}

/** Processes queued background jobs (safety scans, evaluation generation). For cron or a worker. */
async function handle(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "A worker token is required." } }, { status: 401 });
  }
  const stats = await runBackgroundJobs({ budgetMs: 270_000 });
  return NextResponse.json({ data: stats });
}

export const GET = handle;
export const POST = handle;
