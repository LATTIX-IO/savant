import { NextResponse } from "next/server";

import { createNotFoundResponse, getSkillDetailResponse } from "@/server/control-plane/read-model";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const response = getSkillDetailResponse(id);

  if (!response) {
    return NextResponse.json(
      createNotFoundResponse("skill_not_found", `Skill '${id}' was not found.`),
      { status: 404 },
    );
  }

  return NextResponse.json(response);
}