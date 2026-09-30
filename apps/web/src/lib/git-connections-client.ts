import type {
  AssessmentFinding,
  ChangeProposalResponse,
  RepositoryAssessmentResponse,
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

export function fetchRepositoryAssessment(repositoryId: string): Promise<RepositoryAssessmentResponse> {
  return requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}/assessment`);
}

export function setAssessmentFindingDismissed(repositoryId: string, fingerprint: string, dismissed: boolean, reason?: string): Promise<unknown> {
  return requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}/assessment/dismissals`, {
    method: "POST",
    body: JSON.stringify({ fingerprint, dismissed, ...(reason ? { reason } : {}) }),
  });
}

export function proposeAssessmentFixes(repositoryId: string, fingerprints: string[]): Promise<ChangeProposalResponse> {
  return requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}/proposals`, { method: "POST", body: JSON.stringify({ fingerprints }) });
}

export function proposeFileEdits(repositoryId: string, input: { title: string; body?: string; files: Array<{ path: string; content: string }> }): Promise<ChangeProposalResponse> {
  return requestJson(`/api/repositories/${encodeURIComponent(repositoryId)}/proposals`, { method: "POST", body: JSON.stringify(input) });
}

export function approveChangeProposal(proposalId: string): Promise<ChangeProposalResponse> {
  return requestJson(`/api/proposals/${encodeURIComponent(proposalId)}/approve`, { method: "POST" });
}

export function rejectChangeProposal(proposalId: string): Promise<ChangeProposalResponse> {
  return requestJson(`/api/proposals/${encodeURIComponent(proposalId)}/reject`, { method: "POST" });
}

export function fetchSkillAssessment(skillId: string): Promise<{ data: { repositoryId: string | null; findings: AssessmentFinding[] } }> {
  return requestJson(`/api/skills/${encodeURIComponent(skillId)}/assessment`);
}

export function fetchChangeProposal(proposalId: string): Promise<ChangeProposalResponse> {
  return requestJson(`/api/proposals/${encodeURIComponent(proposalId)}`);
}

export type SkillAutomationRun = {
  id: string;
  mode: "generate" | "alignment";
  status: "queued" | "running" | "complete" | "needs_review" | "failed";
  trigger: string;
  rounds: number;
  cases: Array<{ caseId: string; kind: string; prompt: string; round: number; validation: { decision: "accepted" | "rejected" | "needs_review"; reasons: string[]; inScope: number; grounded: number; discriminating: number } }>;
  samples: Array<{ caseId: string; kind: string; verdict: string; quality: number; policyCompliance: boolean; expectedMet: number; judgeConfidence: number }>;
  scorecard: { overallScore?: number; passCount?: number; investigateCount?: number; failCount?: number; qualityScore?: number; complianceScore?: number; groundingScore?: number; actionabilityScore?: number; efficiencyScore?: number } | null;
  alignment: { committedOverall: number; generatedOverall: number; overallDelta: number; coverage: number; committedCases: number; generatedCases: number; dimensionDeltas: Record<string, number> } | null;
  proposalId: string | null;
  models: { generator?: string; executor?: string; judge?: string };
  metrics: { stage?: string; drafted?: number; accepted?: number; rejected?: number; needsReview?: number; acceptanceRate?: number; llmCalls?: number; judgeCalls?: number; durationMs?: number; limitations?: import("@/server/evaluation/limitations").EvalLimitation[] };
  error: string | null;
  fileCount: number;
  createdAt: string;
  completedAt: string | null;
};

export type SkillSafetyScan = {
  status: "complete" | "failed" | "unavailable";
  riskScore: number | null;
  severity: string | null;
  recommendation: string | null;
  issues: Array<{ id: string; category: string; severity: string; title: string; file: string | null; line: number | null; explanation?: string | null; remediation?: string | null }>;
  llmUsed: boolean;
  scannerVersion: string | null;
  error: string | null;
  scannedAt: string;
  commitSha: string;
};

export type SkillAutomation = {
  skillId: string;
  services: { nim: boolean; jev: boolean; generationModel: string | null; judgeModel: string | null };
  canGenerate: boolean;
  hasAnswerKey: boolean;
  runs: SkillAutomationRun[];
  safety: SkillSafetyScan | null;
};

export function fetchSkillAutomation(skillId: string): Promise<{ data: SkillAutomation }> {
  return requestJson(`/api/skills/${encodeURIComponent(skillId)}/automation`);
}

export function startSkillEvalGeneration(skillId: string): Promise<{ data: SkillAutomationRun }> {
  return requestJson(`/api/skills/${encodeURIComponent(skillId)}/automation/generate`, { method: "POST" });
}

// ── Skill catalog ──────────────────────────────────────────────────────

export type CatalogListResponse = {
  data: {
    items: import("@/server/hub/catalog-read").CatalogSkillSummary[];
    total: number;
    sources: import("@/server/hub/catalog-read").CatalogSource[];
    stats: import("@/server/hub/catalog-read").CatalogStats;
  };
};

export async function fetchCatalog(params: { q?: string; source?: string; verdict?: string; limit?: number; offset?: number }): Promise<CatalogListResponse> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== "") search.set(key, String(value));
  const response = await fetch(`/api/public/catalog?${search.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new ControlPlaneClientError("catalog_unavailable", "The catalog is unavailable.", response.status);
  return response.json() as Promise<CatalogListResponse>;
}

export async function fetchCatalogSkill(id: string): Promise<{ data: import("@/server/hub/catalog-read").CatalogSkillDetail }> {
  const response = await fetch(`/api/public/catalog/${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw new ControlPlaneClientError("catalog_skill_unavailable", response.status === 404 ? "That catalog skill wasn't found." : "The catalog is unavailable.", response.status);
  return response.json() as Promise<{ data: import("@/server/hub/catalog-read").CatalogSkillDetail }>;
}

export function requestCatalogAnalysis(id: string): Promise<{ data: { queued: boolean } }> {
  return requestJson(`/api/catalog/${encodeURIComponent(id)}/analyze`, { method: "POST" });
}

export function importCatalogSkill(id: string, input: { repositoryId: string; targetRoot?: string; owner?: string }): Promise<{ data: { proposal: import("@savant/types").ChangeProposal; root: string } }> {
  return requestJson(`/api/catalog/${encodeURIComponent(id)}/import`, { method: "POST", body: JSON.stringify(input) });
}

export function requestCatalogSync(): Promise<{ data: { queued: string[] } }> {
  return requestJson("/api/catalog/sync", { method: "POST" });
}
