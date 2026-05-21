import { NextResponse } from "next/server";

import { listSkillsResponse } from "@/server/control-plane/read-model";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tierParam = searchParams.get("tier");
  const tier = tierParam ? Number(tierParam) : undefined;

  return NextResponse.json(
    listSkillsResponse({
      channel: searchParams.get("channel") ?? undefined,
      query: searchParams.get("query") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      team: searchParams.get("team") ?? undefined,
      tier: Number.isFinite(tier) ? tier : undefined,
    }),
  );
}