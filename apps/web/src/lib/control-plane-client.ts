import type {
  ApiErrorResponse,
  RepositoryDetailResponse,
  RepositoryListResponse,
  SkillListResponse,
} from "@savant/types";

import {
  extractWorkspaceSlugFromPathname,
  withWorkspaceSlugQuery,
} from "./tenant-paths.ts";

type QueryValue = string | number | undefined;
export type TenantRequestOptions = { signal?: AbortSignal; workspaceSlug?: string };

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

function resolveWorkspaceSlug(options?: { workspaceSlug?: string }): string | undefined {
  if (options?.workspaceSlug) {
    return options.workspaceSlug;
  }

  if (typeof window === "undefined") {
    return undefined;
  }

  return extractWorkspaceSlugFromPathname(window.location.pathname) ?? undefined;
}

export function buildTenantScopedControlPlanePath(
  path: string,
  options?: { workspaceSlug?: string },
): string {
  const workspaceSlug = resolveWorkspaceSlug(options);
  return workspaceSlug ? withWorkspaceSlugQuery(path, workspaceSlug) : path;
}

export function fetchRepositoryList(options?: TenantRequestOptions): Promise<RepositoryListResponse> {
  return fetchControlPlaneJson<RepositoryListResponse>(
    buildTenantScopedControlPlanePath("/api/repositories", options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchRepositoryDetail(
  id: string,
  options?: TenantRequestOptions,
): Promise<RepositoryDetailResponse> {
  return fetchControlPlaneJson<RepositoryDetailResponse>(
    buildTenantScopedControlPlanePath(`/api/repositories/${encodeURIComponent(id)}`, options),
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
  options?: TenantRequestOptions,
): Promise<SkillListResponse> {
  return fetchControlPlaneJson<SkillListResponse>(
    buildTenantScopedControlPlanePath(`/api/skills${buildControlPlaneQuery({
      channel: filters?.channel,
      query: filters?.query,
      status: filters?.status,
      team: filters?.team,
      tier: filters?.tier,
    })}`, options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}