import type {
  ControlPlaneResponseMeta,
  GitProvider,
  ResourceResponse,
} from "./control-plane";

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
  checks: RepoContractValidationCheck[];
  missingTopLevelDirectories: string[];
  missingRegistryFiles: string[];
  discoveredSkillPackageRoots: string[];
  nextSteps: string[];
  summary: RepoContractValidationSummary;
}

export type RepoContractValidationResponse = ResourceResponse<RepoContractValidationPayload>;

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

export interface SkillScaffoldPayload {
  skillUuid: string;
  skillId: string;
  packagePath: string;
  directories: RepoScaffoldDirectory[];
  files: RepoScaffoldFile[];
  notes: string[];
}

export type SkillScaffoldResponse = ResourceResponse<SkillScaffoldPayload>;