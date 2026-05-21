import { NextResponse } from "next/server";

import { getOverviewResponse } from "@/server/control-plane/read-model";

export function GET() {
  return NextResponse.json(getOverviewResponse());
}