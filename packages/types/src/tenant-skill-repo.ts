import type {
  ControlPlaneResponseMeta,
  GitProvider,
  RepositoryListItem,
  ResourceResponse,
} from "./control-plane";
import type {
  RepositoryProviderReadiness,
  RepositoryValidationSource,
} from "./repository-provider-readiness";

export interface RepoContractSection {
  key: string;
  description: string;
  paths: readonly string[];
}

export interface GitStorageBoundary {
  gitOwned: readonly RepoContractSection[];
  databaseOwned: readonly RepoContractSection[];
  forbiddenInGit: readonly string[];
}

export interface TenantSkillRepoContract {
  version: 1;
  exampleRepository: string;
  requiredTopLevelDirectories: readonly string[];
  optionalTopLevelDirectories: readonly string[];
  requiredRegistryFiles: readonly string[];
  skillDirectoryGlobs: readonly string[];
  requiredSkillPackageFiles: readonly string[];
  notes: readonly string[];
  storageBoundary: GitStorageBoundary;
}

export interface TenantSkillRepoContractResponse {
  data: TenantSkillRepoContract;
  meta: ControlPlaneResponseMeta;
}

export type RepositoryOnboardingPath = "connect" | "provision";
export type RepositorySyncMode = "webhook" | "poll" | "manual";
export type RepoContractCheckStatus = "ok" | "warn" | "fail" | "pending";

export interface RepoContractValidationCheck {
  key: string;
  label: string;
  status: RepoContractCheckStatus;
  meta: string;
}

export interface RepoContractValidationRequest {
  path: RepositoryOnboardingPath;
  provider: GitProvider;
  repoUrl: string;
  defaultBranch: string;
  displayName: string;
  syncMode?: RepositorySyncMode | undefined;
  observedPaths?: string[] | undefined;
}

export interface RepoContractValidationSummary {
  observedPathCount: number;
  discoveredSkillPackageCount: number;
  missingTopLevelDirectoryCount: number;
  missingRegistryFileCount: number;
}

export interface RepoContractValidationPayload {
  ready: boolean;
  providerReadiness: RepositoryProviderReadiness;
  validationSource: RepositoryValidationSource;
  checks: RepoContractValidationCheck[];
  missingTopLevelDirectories: string[];
  missingRegistryFiles: string[];
  discoveredSkillPackageRoots: string[];
  nextSteps: string[];
  summary: RepoContractValidationSummary;
}

export type RepoContractValidationResponse = ResourceResponse<RepoContractValidationPayload>;

export interface RepoConnectRequest {
  provider: GitProvider;
  repoUrl: string;
  defaultBranch: string;
  displayName: string;
  connectionId?: string | undefined;
  syncMode?: RepositorySyncMode | undefined;
  observedPaths?: string[] | undefined;
}

export interface RepoConnectPayload {
  created: boolean;
  repository: RepositoryListItem;
  warnings: string[];
}

export type RepoConnectResponse = ResourceResponse<RepoConnectPayload>;

export interface RepositoryWriteCommitSummary {
  sha: string;
  committedAt: string;
  url: string | null;
  changedPaths: string[];
}

export type RepositoryVisibility = "private" | "internal" | "public";

export type RepoSyncReason = "manual" | "initial_connect";

export interface RepoSyncRequest {
  reason?: RepoSyncReason | undefined;
}

export interface RepoSyncPayload {
  accepted: boolean;
  repository: RepositoryListItem;
  syncMode: RepositorySyncMode;
  requestedAt: string;
  nextPollAt: string | null;
  indexedSkillCount: number;
  warnings: string[];
  message: string;
}

export type RepoSyncResponse = ResourceResponse<RepoSyncPayload>;

export interface RepoScaffoldDirectory {
  path: string;
  purpose: string;
}

export interface RepoScaffoldFile {
  path: string;
  purpose: string;
  content: string;
}

export interface RepoBootstrapTemplateRequest {
  provider: GitProvider;
  repoUrl: string;
  defaultBranch: string;
  displayName: string;
  syncMode?: RepositorySyncMode | undefined;
}

export interface RepoBootstrapTemplateSummary {
  directoryCount: number;
  fileCount: number;
  includesRegistry: boolean;
  includesEvalScaffolding: boolean;
  includesSkillRoots: boolean;
}

export interface RepoBootstrapTemplatePayload {
  repositorySlug: string;
  directories: RepoScaffoldDirectory[];
  files: RepoScaffoldFile[];
  checks: RepoContractValidationCheck[];
  nextSteps: string[];
  summary: RepoBootstrapTemplateSummary;
}

export type RepoBootstrapTemplateResponse = ResourceResponse<RepoBootstrapTemplatePayload>;

export interface RepoProvisionRequest extends RepoBootstrapTemplateRequest {
  connectionId?: string | undefined;
  visibility?: RepositoryVisibility | undefined;
}

export interface RepoProvisionPayload {
  repository: RepositoryListItem;
  commit: RepositoryWriteCommitSummary;
  indexedSkillCount: number;
  warnings: string[];
}

export type RepoProvisionResponse = ResourceResponse<RepoProvisionPayload>;

export type SkillTierKey = "tier1" | "tier2" | "tier3";
export type SkillLifecycleStatus = "draft" | "active" | "deprecated";
export type Tier3Kind = "personal" | "workflow";

export interface SkillScaffoldRequest {
  displayName: string;
  tier: SkillTierKey;
  owner: string;
  summary: string;
  skillId?: string | undefined;
  packagePath?: string | undefined;
  domain?: string | undefined;
  category?: string | undefined;
  personSlug?: string | undefined;
  tier3Kind?: Tier3Kind | undefined;
  version?: string | undefined;
  status?: SkillLifecycleStatus | undefined;
  dependencies?: string[] | undefined;
}

export interface RegistryUpdatePreview {
  path: string;
  purpose: string;
  preview: string;
}

export interface SkillScaffoldPayload {
  skillUuid: string;
  skillId: string;
  packagePath: string;
  directories: RepoScaffoldDirectory[];
  files: RepoScaffoldFile[];
  registryUpdates: RegistryUpdatePreview[];
  notes: string[];
}

export type SkillScaffoldResponse = ResourceResponse<SkillScaffoldPayload>;

export interface SkillScaffoldApplyRequest extends SkillScaffoldRequest {
  repositoryId: string;
  connectionId?: string | undefined;
}

export interface SkillScaffoldApplyPayload {
  repository: RepositoryListItem;
  skillUuid: string;
  skillId: string;
  packagePath: string;
  commit: RepositoryWriteCommitSummary;
  indexedSkillCount: number;
  warnings: string[];
}

export type SkillScaffoldApplyResponse = ResourceResponse<SkillScaffoldApplyPayload>;