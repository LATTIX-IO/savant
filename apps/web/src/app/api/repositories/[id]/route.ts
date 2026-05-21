import { NextResponse } from "next/server";

import { createNotFoundResponse, getRepositoryDetailResponse } from "@/server/control-plane/read-model";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const response = getRepositoryDetailResponse(id);

  if (!response) {
    return NextResponse.json(
      createNotFoundResponse("repository_not_found", `Repository '${id}' was not found.`),
      { status: 404 },
    );
  }

  return NextResponse.json(response);
}