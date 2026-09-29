import type { GitProviderErrorCode, GitProviderType } from "./types.ts";

const PROVIDER_LABELS: Record<GitProviderType, string> = {
  github: "GitHub",
  gitlab: "GitLab",
  bitbucket: "Bitbucket",
  azure: "Azure Repos",
};

export function providerLabel(provider: GitProviderType): string {
  return PROVIDER_LABELS[provider];
}

const HTTP_STATUS_BY_CODE: Record<GitProviderErrorCode, number> = {
  AUTH_REQUIRED: 401,
  TOKEN_EXPIRED: 401,
  TOKEN_REVOKED: 401,
  INSUFFICIENT_SCOPE: 403,
  REPOSITORY_NOT_FOUND: 404,
  REPOSITORY_ACCESS_DENIED: 403,
  CONNECTION_NOT_FOUND: 404,
  CONNECTION_REQUIRED: 409,
  CONNECTION_AMBIGUOUS: 409,
  PROVIDER_RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 502,
  INVALID_PROVIDER_RESPONSE: 502,
  INDEX_FAILED: 500,
  SYNC_ALREADY_RUNNING: 409,
  PROVIDER_NOT_CONFIGURED: 503,
  PROVIDER_HOST_REJECTED: 400,
  AUTHORIZATION_STATE_INVALID: 400,
  PERMISSION_DENIED: 403,
  INVALID_REQUEST: 400,
};

/** Codes that indicate the connection's authorization itself is no longer usable. */
const CONNECTION_AUTH_FAILURE_CODES = new Set<GitProviderErrorCode>([
  "AUTH_REQUIRED",
  "TOKEN_EXPIRED",
  "TOKEN_REVOKED",
]);

const RETRYABLE_CODES = new Set<GitProviderErrorCode>([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
]);

export class GitProviderError extends Error {
  readonly code: GitProviderErrorCode;
  readonly status: number;
  readonly provider: GitProviderType | null;
  readonly retryAfterMs: number | null;
  readonly details: string | undefined;

  constructor(
    code: GitProviderErrorCode,
    message: string,
    options?: {
      provider?: GitProviderType | null | undefined;
      status?: number | undefined;
      retryAfterMs?: number | null | undefined;
      details?: string | undefined;
    },
  ) {
    super(message);
    this.name = "GitProviderError";
    this.code = code;
    this.status = options?.status ?? HTTP_STATUS_BY_CODE[code];
    this.provider = options?.provider ?? null;
    this.retryAfterMs = options?.retryAfterMs ?? null;
    this.details = options?.details;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  /** Serializes without any request/response bodies or credentials. */
  toJSON() {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      provider: this.provider,
      message: this.message,
    };
  }
}

export function isGitProviderError(error: unknown): error is GitProviderError {
  return error instanceof GitProviderError;
}

export function isConnectionAuthFailure(code: GitProviderErrorCode): boolean {
  return CONNECTION_AUTH_FAILURE_CODES.has(code);
}

export function isRetryableGitError(error: unknown): boolean {
  return error instanceof GitProviderError && error.retryable;
}

export type ProviderHttpFailureContext = {
  provider: GitProviderType;
  status: number;
  /** Whether the request targeted a specific, already-known repository. */
  repositoryKnown?: boolean | undefined;
  /** Whether the call was made with a credential (vs anonymously). */
  authenticated?: boolean | undefined;
  retryAfterMs?: number | null | undefined;
  /** Provider-native error hints (e.g. OAuth `error` field, GitHub rate-limit headers). */
  oauthError?: string | undefined;
  rateLimitExhausted?: boolean | undefined;
  insufficientScope?: boolean | undefined;
  subject?: string | undefined;
};

/**
 * Translates a native provider HTTP failure into the standardized error model.
 * A 404 for a repository Savant already knows about is treated as an access
 * problem, not absence (INV-GIT-08): private repositories are reported as
 * missing to credentials that cannot see them.
 */
export function normalizeProviderHttpFailure(context: ProviderHttpFailureContext): GitProviderError {
  const label = providerLabel(context.provider);
  const subject = context.subject ? ` for ${context.subject}` : "";
  const options = { provider: context.provider, retryAfterMs: context.retryAfterMs ?? null };

  if (context.oauthError === "invalid_grant") {
    return new GitProviderError(
      "TOKEN_REVOKED",
      `${label} rejected the stored authorization. Reauthorize ${label} to continue.`,
      options,
    );
  }

  if (context.status === 429 || context.rateLimitExhausted) {
    return new GitProviderError(
      "PROVIDER_RATE_LIMITED",
      `${label} rate limited Savant${subject}. Savant will retry automatically; try again shortly.`,
      options,
    );
  }

  if (context.status === 401) {
    return new GitProviderError(
      context.authenticated === false ? "AUTH_REQUIRED" : "TOKEN_EXPIRED",
      context.authenticated === false
        ? `${label} requires authorization${subject}. Connect ${label} in Settings → Source control.`
        : `${label} no longer accepts Savant's authorization${subject}. Reauthorize ${label}.`,
      options,
    );
  }

  if (context.status === 403) {
    if (context.insufficientScope) {
      return new GitProviderError(
        "INSUFFICIENT_SCOPE",
        `${label} authorization is missing a required read permission${subject}. Reauthorize ${label} and grant repository read access.`,
        options,
      );
    }

    return new GitProviderError(
      "REPOSITORY_ACCESS_DENIED",
      `${label} authorization does not currently provide access${subject}.`,
      options,
    );
  }

  if (context.status === 404) {
    if (context.repositoryKnown) {
      return new GitProviderError(
        "REPOSITORY_ACCESS_DENIED",
        `${label} authorization does not currently provide access${subject}, or the repository was renamed or deleted.`,
        { ...options, status: 403 },
      );
    }

    return new GitProviderError(
      "REPOSITORY_NOT_FOUND",
      `${label} could not find the requested resource${subject}.`,
      options,
    );
  }

  if (context.status >= 500) {
    return new GitProviderError(
      "PROVIDER_UNAVAILABLE",
      `${label} is temporarily unavailable (status ${context.status}). Savant will retry.`,
      options,
    );
  }

  return new GitProviderError(
    "INVALID_PROVIDER_RESPONSE",
    `${label} returned an unexpected response (status ${context.status})${subject}.`,
    options,
  );
}

/**
 * User-facing remediation text keyed by standardized code. The UI shows the
 * specific remediation instead of a generic "complete provider authorization".
 */
export function describeGitRemediation(input: {
  code: string | null | undefined;
  provider: GitProviderType | string;
  repositoryName?: string | undefined;
}): string | null {
  const provider = (PROVIDER_LABELS as Record<string, string>)[input.provider] ?? input.provider;
  const repo = input.repositoryName ?? "this repository";

  switch (input.code) {
    case "REPOSITORY_ACCESS_DENIED":
    case "REPOSITORY_NOT_FOUND":
      return input.provider === "github"
        ? `Your GitHub authorization no longer provides access to ${repo}. Reauthorize GitHub or grant the Savant GitHub App access to this repository.`
        : `Your ${provider} authorization does not provide access to ${repo}. Reauthorize ${provider} with an account that can read it.`;
    case "AUTH_REQUIRED":
    case "TOKEN_EXPIRED":
    case "TOKEN_REVOKED":
      return `${provider} authorization is no longer valid. Reauthorize ${provider} in Settings → Source control, then retry sync.`;
    case "INSUFFICIENT_SCOPE":
      return `${provider} authorization is missing repository read permission. Reauthorize ${provider} and approve read access.`;
    case "CONNECTION_REQUIRED":
    case "CONNECTION_NOT_FOUND":
      return `Connect ${provider} in Settings → Source control so Savant can read ${repo}.`;
    case "CONNECTION_AMBIGUOUS":
      return `Choose which ${provider} connection should access ${repo}.`;
    case "PROVIDER_RATE_LIMITED":
      return `${provider} is rate limiting requests. Savant will retry; you can also retry sync in a few minutes.`;
    case "PROVIDER_UNAVAILABLE":
      return `${provider} is temporarily unavailable. Retry sync shortly.`;
    case "SYNC_ALREADY_RUNNING":
      return "A sync is already running for this repository.";
    default:
      return input.code ? "Retry sync. If the problem persists, validate the provider connection in Settings → Source control." : null;
  }
}
