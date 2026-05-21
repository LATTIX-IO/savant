import type { ControlPlaneResponseMeta } from "./control-plane";

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