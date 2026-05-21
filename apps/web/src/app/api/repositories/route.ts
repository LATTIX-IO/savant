import { NextResponse } from "next/server";

import { listRepositoriesResponse } from "@/server/control-plane/read-model";

export function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  return NextResponse.json(
    listRepositoriesResponse({
      provider: searchParams.get("provider") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    }),
  );
}