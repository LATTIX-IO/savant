import type {
  ApiErrorResponse,
  GitAuthorizeRequest,
  GitAuthorizeResponse,
  GitConnectionListResponse,
  GitConnectionValidationResponse,
  GitDiscoveredRepositoryListResponse,
  GitManualTokenConnectRequest,
  GitManualTokenConnectResponse,
  GitProviderListResponse,
  GitProviderType,
  RepositoryConnectSelectionRequest,
  RepositoryConnectSelectionResponse,
  RepositorySyncStatusResponse,
} from "@savant/types";

import { buildControlPlaneQuery, buildTenantScopedControlPlanePath, ControlPlaneClientError } from "./control-plane-client.ts";

/**
 * Browser client for the Source Control API. Credentials are only ever sent
 * to the server (manual tokens, self-managed OAuth app secrets); no response
 * contains provider credentials, and nothing here touches browser storage.
 */

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Accept", "application/json");
  if (init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(buildTenantScopedControlPlanePath(path), { ...init, headers, cache: "no-store" });
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Handled below.
  }

  if (!response.ok || (payload && typeof payload === "object" && "error" in payload)) {
    const error = (payload as ApiErrorResponse | null)?.error;
    throw new ControlPlaneClientError(error?.code ?? "git_request_failed", error?.message ?? `Request failed with status ${response.status}.`, response.status);
  }

  return payload as T;
}

export function fetchGitProviders(): Promise<GitProviderListResponse> {
  return requestJson("/api/git/providers");
}

export function fetchGitConnections(): Promise<GitConnectionListResponse> {
  return requestJson("/api/git/connections");
}

export function startGitAuthorization(provider: GitProviderType, request: GitAuthorizeRequest = {}): Promise<GitAuthorizeResponse> {
  return requestJson(`/api/git/connections/${provider}/authorize`, { method: "POST", body: JSON.stringify(request) });
}

export function reauthorizeGitConnection(connectionId: string, request: GitAuthorizeRequest = {}): Promise<GitAuthorizeResponse> {
  return requestJson(`/api/git/connections/${encodeURIComponent(connectionId)}/reauthorize`, { method: "POST", body: JSON.stringify(request) });
}

export function validateGitConnection(connectionId: string): Promise<GitConnectionValidationResponse> {
  return requestJson(`/api/git/connections/${encodeURIComponent(connectionId)}/validate`, { method: "POST" });
}

export function disconnectGitConnection(connectionId: string): Promise<{ data: { repositoriesMarked: number; revokedRemotely: boolean } }> {
  return requestJson(`/api/git/connections/${encodeURIComponent(connectionId)}`, { method: "DELETE" });
}

export function connectGitManualToken(request: GitManualTokenConnectRequest): Promise<GitManualTokenConnectResponse> {
  return requestJson("/api/git/connections", { method: "POST", body: JSON.stringify(request) });
}

export function fetchDiscoveredRepositories(connectionId: string, options: { cursor?: string | null; search?: string } = {}): Promise<GitDiscoveredRepositoryListResponse> {
  const query = buildControlPlaneQuery({ cursor: options.cursor ?? undefined, search: options.search });
  return requestJson(`/api/git/connections/${encodeURIComponent(connectionId)}/repositories${query}`);
}

export function connectSelectedRepositories(
  request: RepositoryConnectSelectionRequest & { repositories: Array<{ providerRepositoryId: string; fullName?: string }> },
): Promise<RepositoryConnectSelectionResponse> {
  return requestJson("/api/repositories", { method: "POST", body: JSON.stringify(request) });
}

export function fetchRepositorySyncStatus(repositoryId: string): Promise<RepositorySyncStatusResponse> {
  return requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}/sync-status`);
}

export function assignRepositoryConnection(repositoryId: string, connectionId: string): Promise<unknown> {
  return requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}/connection`, { method: "PUT", body: JSON.stringify({ connectionId }) });
}

export function removeRepository(repositoryId: string): Promise<{ data: { removedSkillCount: number } }> {
  return requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}`, { method: "DELETE" });
}
