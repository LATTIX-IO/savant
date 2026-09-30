import { after, NextResponse } from "next/server";

import { enqueueHubSync } from "@/server/hub/jobs";
import { createHubStore } from "@/server/hub/store";
import { createJobQueue } from "@/server/jobs/queue";
import { runAndContinue } from "@/server/jobs/runner";
import { isAuthorizedWorker } from "@/server/jobs/worker-auth";

export const maxDuration = 300;

/** Queues a sync of every enabled catalog source (or `?source=id`), then starts processing. Daily via Vercel Cron. */
async function handle(request: Request) {
  if (!isAuthorizedWorker(request)) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "A worker token is required." } }, { status: 401 });
  }
  const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
  const sql = getControlPlaneDatabase();
  const only = new URL(request.url).searchParams.get("source");
  const sources = (await createHubStore(sql).listSources()).filter((source) => source.enabled && (!only || source.id === only));
  await enqueueHubSync(createJobQueue(sql), sources.map((source) => source.id));
  after(async () => {
    await runAndContinue(0);
  });
  return NextResponse.json({ data: { queued: sources.map((source) => source.id) } }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
