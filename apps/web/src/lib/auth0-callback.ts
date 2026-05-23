import { normalizeReturnToPath } from "./auth0-config.ts";

const SAFE_AUTH_CALLBACK_CODE = /^[a-z0-9_:-]{1,64}$/i;

type ErrorWithCode = {
  code?: unknown;
  error_description?: unknown;
  message?: unknown;
  cause?: unknown;
};

export type AuthCallbackFailure = {
  sdkErrorCode: string | null;
  oauthErrorCode: string | null;
  oauthErrorDescription: string | null;
};

function sanitizeAuthCallbackCode(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (!normalized || !SAFE_AUTH_CALLBACK_CODE.test(normalized)) {
    return null;
  }

  return normalized;
}

function sanitizeAuthCallbackDescription(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!normalized || /[\u0000-\u001f\u007f<>`]/.test(normalized)) {
    return null;
  }

  if (normalized.length <= 200) {
    return normalized;
  }

  return `${normalized.slice(0, 197).trimEnd()}...`;
}

function readErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return sanitizeAuthCallbackCode((error as ErrorWithCode).code);
}

function readErrorCause(error: unknown): unknown {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return (error as ErrorWithCode).cause;
}

function readErrorDescription(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }

  return sanitizeAuthCallbackDescription((error as ErrorWithCode).error_description)
    ?? sanitizeAuthCallbackDescription((error as ErrorWithCode).message);
}

export function extractAuthCallbackFailure(error: unknown): AuthCallbackFailure {
  const sdkErrorCode = readErrorCode(error);
  const directCause = readErrorCause(error);
  const nestedCause = readErrorCause(directCause);
  const oauthErrorCode = readErrorCode(directCause) ?? readErrorCode(nestedCause);
  const oauthErrorDescription = readErrorDescription(directCause) ?? readErrorDescription(nestedCause);

  return {
    sdkErrorCode,
    oauthErrorCode,
    oauthErrorDescription,
  };
}

export function readAuthCallbackFailureParams(params: {
  callbackError?: string | undefined;
  oauthError?: string | undefined;
  oauthMessage?: string | undefined;
}): AuthCallbackFailure | null {
  const sdkErrorCode = sanitizeAuthCallbackCode(params.callbackError);
  const oauthErrorCode = sanitizeAuthCallbackCode(params.oauthError);
  const oauthErrorDescription = sanitizeAuthCallbackDescription(params.oauthMessage);

  if (!sdkErrorCode && !oauthErrorCode && !oauthErrorDescription) {
    return null;
  }

  return {
    sdkErrorCode,
    oauthErrorCode,
    oauthErrorDescription,
  };
}

export function buildAuthCallbackFailureHref({
  returnTo,
  sdkErrorCode,
  oauthErrorCode,
  oauthErrorDescription,
}: AuthCallbackFailure & {
  returnTo?: string | undefined;
}): string {
  const search = new URLSearchParams({
    source: "signin",
    returnTo: normalizeReturnToPath(returnTo, "/dashboard"),
  });

  if (sdkErrorCode) {
    search.set("callbackError", sdkErrorCode);
  }

  if (oauthErrorCode) {
    search.set("oauthError", oauthErrorCode);
  }

  if (oauthErrorDescription) {
    search.set("oauthMessage", oauthErrorDescription);
  }

  return `/auth-status?${search.toString()}`;
}

export function getAuthCallbackFailureHint(failure: AuthCallbackFailure | null): string | null {
  if (!failure) {
    return null;
  }

  if (
    failure.sdkErrorCode === "authorization_code_grant_error"
    && failure.oauthErrorCode === "invalid_client"
  ) {
    return "Auth0 rejected Savant during the server-side token exchange. The most likely fix is to update AUTH0_CLIENT_SECRET in the deployment so it matches the Auth0 Regular Web Application, then redeploy.";
  }

  if (
    failure.sdkErrorCode === "authorization_code_grant_error"
    && failure.oauthErrorCode === "invalid_grant"
  ) {
    return "Auth0 rejected the authorization code. Retry with a fresh login, then verify APP_BASE_URL and the Allowed Callback URLs exactly match the deployed origin.";
  }

  if (
    failure.sdkErrorCode === "authorization_code_grant_error"
    && failure.oauthErrorCode === "invalid_request"
  ) {
    const normalizedDescription = failure.oauthErrorDescription?.toLowerCase() ?? null;

    if (normalizedDescription?.includes("redirect_uri")) {
      return "Auth0 rejected the callback URL used during the token exchange. Verify APP_BASE_URL and the Auth0 Allowed Callback URLs exactly match https://savantrepo.com/auth/callback before redeploying.";
    }

    if (
      normalizedDescription?.includes("grant type")
      && normalizedDescription.includes("authorization_code")
    ) {
      return "Auth0 is rejecting the authorization_code grant for this application. Verify the client is a Regular Web Application and that the Authorization Code grant is enabled before redeploying.";
    }

    if (
      normalizedDescription?.includes("unauthorized")
      || normalizedDescription?.includes("client secret")
      || normalizedDescription?.includes("client authentication")
    ) {
      return "Auth0 is rejecting Savant's confidential-client credentials at the token endpoint. Rotate AUTH0_CLIENT_SECRET, then verify the Auth0 application is a Regular Web Application using client_secret_post before redeploying.";
    }

    return "Auth0 rejected Savant's token request as malformed. Re-save AUTH0_CLIENT_SECRET in the deployment as the raw secret value with no quotes or extra whitespace, then verify the Auth0 application is a Regular Web Application using client_secret_post before redeploying.";
  }

  if (failure.sdkErrorCode === "invalid_state" || failure.sdkErrorCode === "missing_state") {
    return "The callback returned without a matching transaction cookie. Retry from the same browser session and verify cookies are not being stripped between /auth/login and /auth/callback.";
  }

  if (failure.sdkErrorCode === "authorization_code_grant_request_error") {
    return "Savant could not complete the server-side token request to Auth0. Check outbound connectivity, tenant availability, and any proxy or firewall rules between the deployment and Auth0.";
  }

  if (
    failure.sdkErrorCode === "authorization_error"
    && failure.oauthErrorCode === "access_denied"
  ) {
    return "Auth0 or the upstream identity provider denied the login request before Savant could create a session.";
  }

  return null;
}