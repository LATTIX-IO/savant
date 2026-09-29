import "server-only";

import { NextResponse } from "next/server";

import { createApiErrorResponse, createControlPlaneMeta } from "../control-plane/control-plane-response.ts";
import { ReadModelUnavailableError } from "../control-plane/read-model.ts";
import { MutationRequestSecurityError } from "../control-plane/request-security.ts";
import { TenantContextError } from "../control-plane/tenant-context.ts";

import { SkillIntelligenceRuntimeError } from "./runtime.ts";
import { SkillIntelligenceError } from "./service.ts";
import { ActiveJobConflictError } from "./store.ts";

type KnownError = Error & { code: string; status: number; details?: string | undefined };

function isKnownError(error: unknown): error is KnownError {
  return error instanceof SkillIntelligenceError
    || error instanceof SkillIntelligenceRuntimeError
    || error instanceof ActiveJobConflictError
    || error instanceof TenantContextError
    || error instanceof MutationRequestSecurityError
    || error instanceof ReadModelUnavailableError;
}

/** Map domain errors to the control-plane JSON error envelope. */
export async function handleSkillIntelligenceRoute(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (isKnownError(error)) {
      return NextResponse.json(createApiErrorResponse(error.code, error.message, error.details), {
        status: error.status,
      });
    }
    throw error;
  }
}

export function jsonResource<T>(data: T, status = 200): Response {
  return NextResponse.json({ data, meta: createControlPlaneMeta("database") }, { status });
}

export function jsonCollection<T>(data: T[]): Response {
  return NextResponse.json({ data, meta: { ...createControlPlaneMeta("database"), count: data.length } });
}

export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new SkillIntelligenceError("invalid_json_body", "Expected a JSON request body.", 400);
  }
}
