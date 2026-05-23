import { NextResponse } from "next/server";

import type { EvaluationDetailResponse, EvaluationRunDetail } from "@/lib/evaluation-detail-helpers";
import {
  createApiErrorResponse,
  createControlPlaneMeta,
} from "@/server/control-plane/control-plane-response";
import { readEvaluationDetailFromDatabase } from "@/server/control-plane/evaluation-detail-read-model";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";

async function buildFallbackEvaluationDetailResponse(
  uuid: string,
): Promise<EvaluationDetailResponse | null> {
  const { getEvaluationRunDetail } = await import("@/lib/evaluation-detail");
  const detail = getEvaluationRunDetail(uuid);

  if (!detail) {
    return null;
  }

  return {
    data: detail as unknown as EvaluationRunDetail,
    meta: createControlPlaneMeta("mixed"),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ uuid: string }> },
) {
  try {
    const [{ uuid }, tenantContext] = await Promise.all([
      context.params,
      authorizeTenantRequest(request),
    ]);

    const response = tenantContext.isDevelopmentFallback
      ? await buildFallbackEvaluationDetailResponse(uuid)
      : await readEvaluationDetailFromDatabase(tenantContext, uuid);

    if (!response) {
      return NextResponse.json(
        createApiErrorResponse(
          "evaluation_run_not_found",
          `No indexed evaluation run was found for ${uuid}.`,
        ),
        { status: 404 },
      );
    }

    return NextResponse.json(response);
  } catch (error) {
    if (error instanceof TenantContextError) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message), {
        status: error.status,
      });
    }

    throw error;
  }
}
