import type {
  ApiErrorResponse,
  RepositoryDetailResponse,
  RepositoryListResponse,
  SkillListResponse,
} from "@savant/types";

type QueryValue = string | number | undefined;

export class ControlPlaneClientError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = "ControlPlaneClientError";
    this.code = code;
    this.status = status;
  }
}

function isApiErrorResponse(value: unknown): value is ApiErrorResponse {
  return typeof value === "object" && value !== null && "error" in value;
}

export function buildControlPlaneQuery(params: Record<string, QueryValue>): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value == null) {
      continue;
    }

    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }

    searchParams.set(key, normalized);
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

async function fetchControlPlaneJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");

  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    headers,
  });

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new ControlPlaneClientError(
      "invalid_json_response",
      `Expected a JSON response from ${path}.`,
      response.status,
    );
  }

  if (!response.ok) {
    if (isApiErrorResponse(payload)) {
      throw new ControlPlaneClientError(payload.error.code, payload.error.message, response.status);
    }

    throw new ControlPlaneClientError(
      "control_plane_request_failed",
      `Request to ${path} failed with status ${response.status}.`,
      response.status,
    );
  }

  if (isApiErrorResponse(payload)) {
    throw new ControlPlaneClientError(payload.error.code, payload.error.message, response.status);
  }

  return payload as T;
}

export function fetchRepositoryList(options?: { signal?: AbortSignal }): Promise<RepositoryListResponse> {
  return fetchControlPlaneJson<RepositoryListResponse>(
    "/api/repositories",
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchRepositoryDetail(
  id: string,
  options?: { signal?: AbortSignal },
): Promise<RepositoryDetailResponse> {
  return fetchControlPlaneJson<RepositoryDetailResponse>(
    `/api/repositories/${encodeURIComponent(id)}`,
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchSkillList(
  filters?: {
    channel?: string | undefined;
    query?: string | undefined;
    status?: string | undefined;
    team?: string | undefined;
    tier?: number | undefined;
  },
  options?: { signal?: AbortSignal },
): Promise<SkillListResponse> {
  return fetchControlPlaneJson<SkillListResponse>(
    `/api/skills${buildControlPlaneQuery({
      channel: filters?.channel,
      query: filters?.query,
      status: filters?.status,
      team: filters?.team,
      tier: filters?.tier,
    })}`,
    options?.signal ? { signal: options.signal } : undefined,
  );
}