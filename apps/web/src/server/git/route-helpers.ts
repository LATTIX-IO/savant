import "server-only";

import { NextResponse } from "next/server";

import type { ControlPlaneResponseMeta } from "@savant/types";

import { createApiErrorResponse, createControlPlaneMeta } from "../control-plane/control-plane-response.ts";
import { MutationRequestSecurityError } from "../control-plane/request-security.ts";
import { TenantContextError } from "../control-plane/tenant-context.ts";
import { GitProviderError } from "./errors.ts";
import { logGitEvent, redactString } from "./redaction.ts";

export function gitMeta(): ControlPlaneResponseMeta {
  return createControlPlaneMeta("database");
}

/**
 * Maps errors to API responses. Provider and tenant errors carry
 * user-actionable messages; anything unexpected is logged (redacted) and
 * returned as a generic 500 so internals and credentials never reach clients.
 */
export function gitErrorResponse(error: unknown): NextResponse {
  if (error instanceof GitProviderError) {
    return NextResponse.json(createApiErrorResponse(error.code, redactString(error.message)), { status: error.status });
  }

  if (error instanceof TenantContextError || error instanceof MutationRequestSecurityError) {
    return NextResponse.json(createApiErrorResponse(error.code, error.message), { status: error.status });
  }

  if (error instanceof Error && "code" in error && "status" in error && typeof error.status === "number" && typeof error.code === "string") {
    return NextResponse.json(createApiErrorResponse(error.code, redactString(error.message)), { status: error.status });
  }

  logGitEvent("error", "unhandled_route_error", { error });
  return NextResponse.json(createApiErrorResponse("git_internal_error", "The source control request failed unexpectedly."), { status: 500 });
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Fall through.
  }
  throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "Expected a JSON object request body.", { status: 400 });
}

export function readOptionalString(body: Record<string, unknown>, key: string, maxLength: number): string | undefined {
  const value = body[key];
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length > maxLength) {
    throw new GitProviderError("INVALID_PROVIDER_RESPONSE", `${key} is too long.`, { status: 400 });
  }
  return trimmed;
}
