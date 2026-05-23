import { doOriginsMatch, resolveRequestOrigin } from "../../lib/auth0-diagnostics.ts";

export class MutationRequestSecurityError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 403) {
    super(message);
    this.name = "MutationRequestSecurityError";
    this.code = code;
    this.status = status;
  }
}

function normalizeOriginHeader(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function readExpectedRequestOrigin(request: Request): string | null {
  return resolveRequestOrigin({
    forwardedProto: request.headers.get("x-forwarded-proto"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    host: request.headers.get("host"),
    nodeEnv: process.env.NODE_ENV,
  }) ?? normalizeOriginHeader(request.url);
}

export function assertSameOriginMutationRequest(request: Request): void {
  const requestOrigin = normalizeOriginHeader(request.headers.get("origin"))
    ?? normalizeOriginHeader(request.headers.get("referer"));

  if (!requestOrigin) {
    throw new MutationRequestSecurityError(
      "mutation_origin_required",
      "Mutation requests must include an Origin or Referer header.",
      403,
    );
  }

  const expectedOrigin = readExpectedRequestOrigin(request);
  if (doOriginsMatch(requestOrigin, expectedOrigin) !== true) {
    throw new MutationRequestSecurityError(
      "mutation_origin_mismatch",
      "Mutation requests must originate from the current workspace origin.",
      403,
    );
  }
}
