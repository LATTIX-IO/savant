import { NextResponse } from "next/server";

import { getTenantSkillRepoContractResponse } from "@/server/control-plane/read-model";

export function GET() {
  return NextResponse.json(getTenantSkillRepoContractResponse());
}