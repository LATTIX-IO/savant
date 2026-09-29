import { GitProviderError, normalizeProviderHttpFailure } from "./errors.ts";
import { incrementGitMetric, statusClass } from "./observability.ts";
import type { FetchLike, GitProviderType, ProviderRuntimeContext, RuntimeCredential } from "./types.ts";

export type ProviderRequestOptions = ProviderRuntimeContext & {
  provider: GitProviderType;
  credential?: RuntimeCredential | null | undefined;
  method?: string | undefined;
  headers?: Record<string, string> | undefined;
  body?: string | URLSearchParams | undefined;
  /** Treat 404 as an access problem rather than absence. */
  repositoryKnown?: boolean | undefined;
  subject?: string | undefined;
  timeoutMs?: number | undefined;
  maxRetries?: number | undefined;
  /** Hard cap on the response body size in bytes. */
  maxBytes?: number | undefined;
  /** Hook for providers to detect native errors (e.g. insufficient scope) from a failed response. */
  inspectFailure?: ((response: Response, body: string) => Partial<Parameters<typeof normalizeProviderHttpFailure>[0]>) | undefined;
  /** Test hook to avoid real sleeps. */
  sleep?: ((ms: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 400;
const MAX_BACKOFF_MS = 8_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function authorizationHeaderFor(credential: RuntimeCredential | null | undefined): Record<string, string> {
  if (!credential?.accessToken) {
    return {};
  }

  switch (credential.scheme) {
    case "token":
      return { Authorization: `token ${credential.accessToken}` };
    case "basic":
      return { Authorization: `Basic ${Buffer.from(`:${credential.accessToken}`).toString("base64")}` };
    default:
      return { Authorization: `Bearer ${credential.accessToken}` };
  }
}

function parseRetryAfter(response: Response): number | null {
  const retryAfter = response.headers.get("retry-after");

  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) {
      return Math.max(0, date - Date.now());
    }
  }

  const reset = response.headers.get("x-ratelimit-reset");
  const remaining = response.headers.get("x-ratelimit-remaining");
  if (remaining === "0" && reset && /^\d+$/.test(reset)) {
    return Math.max(0, Number(reset) * 1000 - Date.now());
  }

  return null;
}

/** Exponential backoff with full jitter, honoring provider Retry-After when present. */
export function computeBackoffMs(attempt: number, retryAfterMs: number | null, random: () => number = Math.random): number {
  if (retryAfterMs != null) {
    return Math.min(retryAfterMs, 30_000);
  }

  const ceiling = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

function createSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function readBodyWithLimit(response: Response, maxBytes: number | undefined): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? "NaN");
  if (maxBytes != null && Number.isFinite(declared) && declared > maxBytes) {
    throw new GitProviderError("INDEX_FAILED", `Provider response exceeds the ${maxBytes}-byte limit.`, { status: 413 });
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (maxBytes != null && buffer.length > maxBytes) {
    throw new GitProviderError("INDEX_FAILED", `Provider response exceeds the ${maxBytes}-byte limit.`, { status: 413 });
  }

  return buffer;
}

/**
 * Performs a provider API request with credential injection, timeout,
 * normalized errors, and retries for 429/5xx/network failures only. 401 and
 * revoked grants are never retried and never masked as transient.
 */
export async function providerRequest(url: string, options: ProviderRequestOptions): Promise<{ response: Response; body: Buffer }> {
  const fetcher: FetchLike = options.fetcher ?? fetch;
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const sleep = options.sleep ?? defaultSleep;
  let lastError: GitProviderError | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    let response: Response;

    try {
      response = await fetcher(url, {
        method: options.method ?? "GET",
        headers: {
          "User-Agent": "savant-git-integration",
          ...authorizationHeaderFor(options.credential),
          ...options.headers,
        },
        ...(options.body != null ? { body: options.body } : {}),
        redirect: "follow",
        signal: createSignal(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, options.signal),
      });
    } catch (error) {
      incrementGitMetric("git_provider_request_total", { provider: options.provider, status_class: statusClass(0) });

      if (options.signal?.aborted) {
        throw new GitProviderError("PROVIDER_UNAVAILABLE", "The provider request was cancelled.", { provider: options.provider });
      }

      const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      lastError = new GitProviderError(
        "PROVIDER_UNAVAILABLE",
        timedOut ? "The provider took too long to respond." : "The provider could not be reached.",
        { provider: options.provider, status: timedOut ? 504 : 502 },
      );

      if (attempt < maxRetries) {
        await sleep(computeBackoffMs(attempt, null, options.random));
        continue;
      }

      throw lastError;
    }

    incrementGitMetric("git_provider_request_total", { provider: options.provider, status_class: statusClass(response.status) });

    if (response.ok) {
      return { response, body: await readBodyWithLimit(response, options.maxBytes) };
    }

    const bodyText = await response.text().catch(() => "");
    let oauthError: string | undefined;
    try {
      const parsed = JSON.parse(bodyText) as { error?: unknown };
      if (typeof parsed.error === "string") {
        oauthError = parsed.error;
      }
    } catch {
      // Non-JSON error bodies are fine.
    }

    const retryAfterMs = parseRetryAfter(response);
    const rateLimitExhausted = response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0";
    const inspected = options.inspectFailure?.(response, bodyText) ?? {};
    const normalized = normalizeProviderHttpFailure({
      provider: options.provider,
      status: response.status,
      repositoryKnown: options.repositoryKnown,
      authenticated: Boolean(options.credential?.accessToken),
      retryAfterMs,
      oauthError,
      rateLimitExhausted,
      subject: options.subject,
      ...inspected,
    });

    if (normalized.code === "TOKEN_EXPIRED" || normalized.code === "TOKEN_REVOKED" || normalized.code === "AUTH_REQUIRED") {
      incrementGitMetric("git_provider_auth_failure_total", { provider: options.provider, reason: normalized.code });
    }

    if (normalized.retryable && attempt < maxRetries) {
      lastError = normalized;
      await sleep(computeBackoffMs(attempt, retryAfterMs, options.random));
      continue;
    }

    throw normalized;
  }

  throw lastError ?? new GitProviderError("PROVIDER_UNAVAILABLE", "The provider request failed.", { provider: options.provider });
}

export async function providerJson<T>(url: string, options: ProviderRequestOptions): Promise<{ data: T; response: Response }> {
  const { response, body } = await providerRequest(url, {
    ...options,
    headers: { Accept: "application/json", ...options.headers },
  });

  try {
    return { data: JSON.parse(body.toString("utf8")) as T, response };
  } catch {
    throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "The provider returned a response that is not valid JSON.", {
      provider: options.provider,
    });
  }
}

/** Parses an RFC 5988 Link header and returns the `rel="next"` URL. */
export function readNextLink(response: Response): string | null {
  const link = response.headers.get("link");
  if (!link) {
    return null;
  }

  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/i.exec(part.trim());
    if (match?.[1]) {
      return match[1];
    }
  }

  return null;
}

export function encodePathSegments(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<T extends Record<string, unknown>>(cursor: string | undefined, fallback: T): T {
  if (!cursor) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    return typeof parsed === "object" && parsed !== null ? { ...fallback, ...(parsed as T) } : fallback;
  } catch {
    throw new GitProviderError("INVALID_PROVIDER_RESPONSE", "The repository page cursor is invalid.", { status: 400 });
  }
}
