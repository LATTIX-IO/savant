import "server-only";

import type {
  ApiErrorResponse,
  ControlPlaneResponseMeta,
  SourceOfTruth,
} from "@savant/types";

export function createControlPlaneMeta(
  sourceOfTruth: SourceOfTruth,
): ControlPlaneResponseMeta {
  return {
    generatedAt: new Date().toISOString(),
    schemaVersion: 1,
    sourceOfTruth,
  };
}

export function createApiErrorResponse(
  code: string,
  message: string,
  details?: string,
): ApiErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
  };
}