import type {
  AIConnectionCreateRequest,
  AIConnectionListResponse,
  AIConnectionResponse,
  AuditEventRange,
  AuditListResponse,
  AIConnectionRevokeRequest,
  AIConnectionRotateRequest,
  AIConnectionSetDefaultRequest,
  ConnectorDashboardResponse,
  EvaluationDashboardResponse,
  ApiErrorResponse,
  PolicyListResponse,
  ReleaseDashboardResponse,
  RepoProvisionRequest,
  RepoProvisionResponse,
  RepoSyncRequest,
  RepoSyncResponse,
  RepositoryDetailResponse,
  RepositoryListResponse,
  SkillScaffoldApplyRequest,
  SkillScaffoldApplyResponse,
  SkillDetailResponse,
  SkillListResponse,
  SkillSourceResponse,
  SkillSourceUpdateRequest,
  SkillSourceUpdateResponse,
} from "@savant/types";

import type { EvaluationDetailResponse } from "./evaluation-detail-helpers.ts";

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

export function fetchAIConnections(options?: TenantRequestOptions): Promise<AIConnectionListResponse> {
  return fetchControlPlaneJson<AIConnectionListResponse>(
    buildTenantScopedControlPlanePath("/api/ai-connections", options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchAuditEvents(
  filters?: {
    range?: AuditEventRange | undefined;
  },
  options?: TenantRequestOptions,
): Promise<AuditListResponse> {
  return fetchControlPlaneJson<AuditListResponse>(
    buildTenantScopedControlPlanePath(`/api/audit${buildControlPlaneQuery({
      range: filters?.range,
    })}`, options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchPolicies(options?: TenantRequestOptions): Promise<PolicyListResponse> {
  return fetchControlPlaneJson<PolicyListResponse>(
    buildTenantScopedControlPlanePath("/api/policies", options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchReleaseDashboard(options?: TenantRequestOptions): Promise<ReleaseDashboardResponse> {
  return fetchControlPlaneJson<ReleaseDashboardResponse>(
    buildTenantScopedControlPlanePath("/api/releases", options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchConnectorDashboard(options?: TenantRequestOptions): Promise<ConnectorDashboardResponse> {
  return fetchControlPlaneJson<ConnectorDashboardResponse>(
    buildTenantScopedControlPlanePath("/api/connectors", options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchEvaluationDashboard(options?: TenantRequestOptions): Promise<EvaluationDashboardResponse> {
  return fetchControlPlaneJson<EvaluationDashboardResponse>(
    buildTenantScopedControlPlanePath("/api/evaluations", options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchEvaluationDetail(
  id: string,
  options?: TenantRequestOptions,
): Promise<EvaluationDetailResponse> {
  return fetchControlPlaneJson<EvaluationDetailResponse>(
    buildTenantScopedControlPlanePath(`/api/evaluations/${encodeURIComponent(id)}`, options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function createAIConnection(
  request: AIConnectionCreateRequest,
  options?: TenantRequestOptions,
): Promise<AIConnectionResponse> {
  return fetchControlPlaneJson<AIConnectionResponse>(
    buildTenantScopedControlPlanePath("/api/ai-connections", options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

export function revokeAIConnection(
  id: string,
  request: AIConnectionRevokeRequest = {},
  options?: TenantRequestOptions,
): Promise<AIConnectionResponse> {
  return fetchControlPlaneJson<AIConnectionResponse>(
    buildTenantScopedControlPlanePath(`/api/ai-connections/${encodeURIComponent(id)}/revoke`, options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

export function rotateAIConnection(
  id: string,
  request: AIConnectionRotateRequest,
  options?: TenantRequestOptions,
): Promise<AIConnectionResponse> {
  return fetchControlPlaneJson<AIConnectionResponse>(
    buildTenantScopedControlPlanePath(`/api/ai-connections/${encodeURIComponent(id)}/rotate`, options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

export function setAIConnectionDefaults(
  id: string,
  request: AIConnectionSetDefaultRequest,
  options?: TenantRequestOptions,
): Promise<AIConnectionResponse> {
  return fetchControlPlaneJson<AIConnectionResponse>(
    buildTenantScopedControlPlanePath(`/api/ai-connections/${encodeURIComponent(id)}/default`, options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
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

export function triggerRepositorySync(
  id: string,
  request: RepoSyncRequest = {},
  options?: TenantRequestOptions,
): Promise<RepoSyncResponse> {
  return fetchControlPlaneJson<RepoSyncResponse>(
    buildTenantScopedControlPlanePath(`/api/repositories/${encodeURIComponent(id)}/sync`, options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

export function provisionRepository(
  request: RepoProvisionRequest,
  options?: TenantRequestOptions,
): Promise<RepoProvisionResponse> {
  return fetchControlPlaneJson<RepoProvisionResponse>(
    buildTenantScopedControlPlanePath("/api/repositories/provision", options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}

export function applySkillScaffold(
  request: SkillScaffoldApplyRequest,
  options?: TenantRequestOptions,
): Promise<SkillScaffoldApplyResponse> {
  return fetchControlPlaneJson<SkillScaffoldApplyResponse>(
    buildTenantScopedControlPlanePath("/api/skills/scaffold/apply", options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
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

export function fetchSkillDetail(
  id: string,
  options?: TenantRequestOptions,
): Promise<SkillDetailResponse> {
  return fetchControlPlaneJson<SkillDetailResponse>(
    buildTenantScopedControlPlanePath(`/api/skills/${encodeURIComponent(id)}`, options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function fetchSkillSource(
  id: string,
  options?: TenantRequestOptions,
): Promise<SkillSourceResponse> {
  return fetchControlPlaneJson<SkillSourceResponse>(
    buildTenantScopedControlPlanePath(`/api/skills/${encodeURIComponent(id)}/source`, options),
    options?.signal ? { signal: options.signal } : undefined,
  );
}

export function updateSkillSource(
  id: string,
  request: SkillSourceUpdateRequest,
  options?: TenantRequestOptions,
): Promise<SkillSourceUpdateResponse> {
  return fetchControlPlaneJson<SkillSourceUpdateResponse>(
    buildTenantScopedControlPlanePath(`/api/skills/${encodeURIComponent(id)}/source`, options),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(request),
      ...(options?.signal ? { signal: options.signal } : {}),
    },
  );
}