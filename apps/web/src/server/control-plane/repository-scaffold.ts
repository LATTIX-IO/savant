import { tenantSkillRepoContract } from "@savant/schemas/tenant-skill-repo-contract";
import {
  getPreferredRepositorySyncMode,
  getRepositoryProviderReadiness,
  supportsRepositorySyncMode,
} from "@savant/types";
import type {
  RepoBootstrapTemplatePayload,
  RepoBootstrapTemplateRequest,
  RepoContractCheckStatus,
  RepoContractValidationCheck,
  RepoContractValidationPayload,
  RepoContractValidationRequest,
  RepoScaffoldDirectory,
  RepoScaffoldFile,
  RepositoryValidationSource,
} from "@savant/types";

const DIRECTORY_PURPOSES: RepoScaffoldDirectory[] = [
  { path: "docs", purpose: "Repository-level onboarding and operational documentation." },
  { path: "registry", purpose: "Canonical skill index, owner map, dependency map, and routing policies." },
  { path: "sources/legacy", purpose: "Optional migration traceability for imported or replaced skills." },
  { path: "tier1/standards", purpose: "Shared standards and high-governance common skills." },
  { path: "tier2/methodology", purpose: "Reusable methodology packages grouped by domain." },
  { path: "tier3/personal", purpose: "Personalized operator-specific skill packages." },
  { path: "tier3/workflow", purpose: "Narrow workflow packages shared across teams." },
  { path: "evals/baselines", purpose: "Retained baseline scorecards and comparison summaries." },
  { path: "evals/datasets", purpose: "Repository-level authored evaluation datasets." },
  { path: "evals/fixtures", purpose: "Supporting evaluation fixtures and sample payloads." },
  { path: "evals/rubrics", purpose: "Repository-level rubric definitions and scoring guides." },
  { path: "evals/runs", purpose: "Retained evaluation artifacts that are intentionally versioned." },
  { path: "scripts", purpose: "Validation and scaffolding helpers owned by the tenant." },
  { path: "templates", purpose: "Starter artifacts and reusable internal templates." },
];

const TOP_LEVEL_PURPOSES: Record<string, string> = {
  docs: "Documentation",
  evals: "Evaluation assets",
  registry: "Registry metadata",
  scripts: "Repository automation helpers",
  sources: "Legacy and migration traceability",
  templates: "Starter templates",
  tier1: "Tier 1 skill packages",
  tier2: "Tier 2 skill packages",
  tier3: "Tier 3 skill packages",
};

function normalizePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "");
}

function slugifySegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-") || "repo";
}

function inferRepositorySlug(repoUrl: string, displayName: string): string {
  const trimmed = repoUrl.trim();
  const slashParts = trimmed.split("/").filter(Boolean);
  const lastPart = slashParts.at(-1)?.replace(/\.git$/i, "");

  if (lastPart && /^[a-zA-Z0-9._-]+$/.test(lastPart)) {
    return slugifySegment(lastPart);
  }

  return slugifySegment(displayName);
}

function uniqueNormalizedPaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizePath).filter(Boolean))];
}

function inferSkillPackageRoots(paths: readonly string[]): string[] {
  const discovered = new Set<string>();

  for (const path of paths) {
    const normalized = normalizePath(path);
    const parts = normalized.split("/").filter(Boolean);

    if (parts[0] === "tier1" && parts[1] === "standards" && parts[2]) {
      discovered.add(parts.slice(0, 3).join("/"));
      continue;
    }

    if (parts[0] === "tier2" && parts[1] === "methodology" && parts[2] && parts[3]) {
      discovered.add(parts.slice(0, 4).join("/"));
      continue;
    }

    if (
      parts[0] === "tier3" &&
      (parts[1] === "personal" || parts[1] === "workflow") &&
      parts[2] &&
      parts[3]
    ) {
      discovered.add(parts.slice(0, 4).join("/"));
    }
  }

  return [...discovered].sort();
}

function buildProvisionObservedPaths(files: readonly RepoScaffoldFile[]): string[] {
  return uniqueNormalizedPaths([
    ...DIRECTORY_PURPOSES.map((entry) => entry.path),
    ...files.map((file) => file.path),
  ]);
}

function createCheck(
  key: string,
  label: string,
  status: RepoContractCheckStatus,
  meta: string,
): RepoContractValidationCheck {
  return { key, label, status, meta };
}

function checkProviderSupport(request: RepoContractValidationRequest): RepoContractValidationCheck {
  const readiness = getRepositoryProviderReadiness(request.provider);
  const syncMode = request.syncMode ?? getPreferredRepositorySyncMode(readiness);

  if (request.path === "provision" && !readiness.supportsProvisioningWrites) {
    return createCheck(
      "provider-support",
      "Provider capabilities",
      "fail",
      readiness.provisioningWrites.message,
    );
  }

  if (!supportsRepositorySyncMode(readiness, syncMode)) {
    return createCheck(
      "provider-support",
      "Provider capabilities",
      "fail",
      syncMode === "webhook"
        ? readiness.webhookRegistration.message
        : readiness.immediateIndexing.message,
    );
  }

  if (request.path === "connect" && !readiness.supportsLiveTreePreview) {
    return createCheck(
      "provider-support",
      "Provider capabilities",
      "warn",
      readiness.liveTreePreview.message,
    );
  }

  return createCheck(
    "provider-support",
    "Provider capabilities",
    "ok",
    request.path === "provision"
      ? `${request.provider} selected for provider-backed provisioning with ${syncMode} sync`
      : `${request.provider} selected for ${syncMode} repository management`,
  );
}

function checkBranch(defaultBranch: string): RepoContractValidationCheck {
  const valid = /^[A-Za-z0-9._/-]{1,100}$/.test(defaultBranch);

  return createCheck(
    "default-branch",
    "Default branch",
    valid ? "ok" : "fail",
    valid ? defaultBranch : "Branch names must use a safe Git ref format",
  );
}

function buildTopLevelDirectoryCheck(missingTopLevelDirectories: readonly string[]): RepoContractValidationCheck {
  return createCheck(
    "top-level-directories",
    "Required top-level directories",
    missingTopLevelDirectories.length === 0 ? "ok" : "fail",
    missingTopLevelDirectories.length === 0
      ? `${tenantSkillRepoContract.requiredTopLevelDirectories.length} directories ready`
      : `missing ${missingTopLevelDirectories.join(", ")}`,
  );
}

function buildPendingTopLevelDirectoryCheck(): RepoContractValidationCheck {
  return createCheck(
    "top-level-directories",
    "Required top-level directories",
    "pending",
    "Repository tree snapshot required before top-level contract completeness can be checked",
  );
}

function buildRegistryCheck(missingRegistryFiles: readonly string[]): RepoContractValidationCheck {
  return createCheck(
    "registry-files",
    "Required registry files",
    missingRegistryFiles.length === 0 ? "ok" : "fail",
    missingRegistryFiles.length === 0
      ? `${tenantSkillRepoContract.requiredRegistryFiles.length} registry files ready`
      : `missing ${missingRegistryFiles.join(", ")}`,
  );
}

function buildPendingRegistryCheck(): RepoContractValidationCheck {
  return createCheck(
    "registry-files",
    "Required registry files",
    "pending",
    "Repository tree snapshot required before registry files can be verified",
  );
}

function buildSkillRootsCheck(
  request: RepoContractValidationRequest,
  discoveredSkillPackageRoots: readonly string[],
  hasObservedSnapshot: boolean,
): RepoContractValidationCheck {
  if (request.path === "provision") {
    return createCheck(
      "skill-roots",
      "Tiered skill roots",
      "ok",
      "Bootstrap creates tier1, tier2, and tier3 roots for future skill packages",
    );
  }

  if (!hasObservedSnapshot) {
    return createCheck(
      "skill-roots",
      "Skill packages discovered",
      "pending",
      "Repository tree snapshot required before Savant can discover skill packages",
    );
  }

  if (discoveredSkillPackageRoots.length === 0) {
    return createCheck(
      "skill-roots",
      "Skill packages discovered",
      "warn",
      "No concrete skill packages found yet in the provided repository snapshot",
    );
  }

  return createCheck(
    "skill-roots",
    "Skill packages discovered",
    "ok",
    `${discoveredSkillPackageRoots.length} package roots matched the Savant contract`,
  );
}

function buildEvalScaffoldingCheck(
  request: RepoContractValidationRequest,
  observedPaths: readonly string[],
  hasObservedSnapshot: boolean,
): RepoContractValidationCheck {
  const hasEvalDirectory = observedPaths.some(
    (path) => path.startsWith("evals/") || path.includes("/eval/"),
  );

  if (request.path === "provision") {
    return createCheck(
      "eval-scaffolding",
      "Evaluation scaffolding",
      "ok",
      "Repository template includes dataset, rubric, baseline, and retained run roots",
    );
  }

  if (!hasObservedSnapshot) {
    return createCheck(
      "eval-scaffolding",
      "Evaluation scaffolding",
      "pending",
      "Repository tree snapshot required before eval assets can be checked",
    );
  }

  return createCheck(
    "eval-scaffolding",
    "Evaluation scaffolding",
    hasEvalDirectory ? "ok" : "warn",
    hasEvalDirectory
      ? "Repository snapshot includes eval assets"
      : "No eval assets found yet; Savant can scaffold them during skill creation",
  );
}

function buildSnapshotCheck(
  request: RepoContractValidationRequest,
  observedPaths: readonly string[],
): RepoContractValidationCheck {
  if (request.path === "provision") {
    return createCheck(
      "repository-snapshot",
      "Bootstrap preview",
      "ok",
      "Savant generated a contract-compliant repository scaffold preview",
    );
  }

  if (observedPaths.length === 0) {
    const readiness = getRepositoryProviderReadiness(request.provider);

    return createCheck(
      "repository-snapshot",
      "Repository snapshot",
      "pending",
      readiness.supportsLiveTreePreview
        ? "Provider handshake and tree fetch are required before full remote validation"
        : readiness.liveTreePreview.message,
    );
  }

  return createCheck(
    "repository-snapshot",
    "Repository snapshot",
    "ok",
    `${observedPaths.length} paths inspected from the provided repository snapshot`,
  );
}

function buildNextSteps(
  request: RepoContractValidationRequest,
  ready: boolean,
  hasObservedSnapshot: boolean,
  missingTopLevelDirectories: readonly string[],
  missingRegistryFiles: readonly string[],
): string[] {
  if (request.path === "provision") {
    const readiness = getRepositoryProviderReadiness(request.provider);
    const syncMode = request.syncMode ?? getPreferredRepositorySyncMode(readiness);

    if (!readiness.supportsProvisioningWrites) {
      return [
        "Use GitHub for provider-backed repository provisioning and scaffold/apply writes in the current secure MVP.",
        "Or create the repository in your Git provider first, then connect it with poll or manual sync.",
      ];
    }

    return [
      "Create the repository in the selected provider using the generated scaffold.",
      `Commit bootstrap files to ${request.defaultBranch} and keep the repository on ${syncMode} sync.`,
      "Create the first skill package from Savant once the repository is connected.",
    ];
  }

  if (!hasObservedSnapshot) {
    return [
      "Complete provider authorization and fetch the repository tree before ingest.",
      "Paste or import a repository path snapshot to preview the contract check before live provider sync is wired.",
    ];
  }

  if (!ready && missingTopLevelDirectories.length === 0 && missingRegistryFiles.length === 0) {
    return [
      "Re-run contract validation with observed repository paths.",
    ];
  }

  const nextSteps: string[] = [];

  if (missingTopLevelDirectories.length > 0) {
    nextSteps.push(
      `Add missing top-level directories: ${missingTopLevelDirectories.join(", ")}.`,
    );
  }

  if (missingRegistryFiles.length > 0) {
    nextSteps.push(
      `Add missing registry files: ${missingRegistryFiles.join(", ")}.`,
    );
  }

  if (nextSteps.length === 0) {
    nextSteps.push("Repository contract is satisfied; proceed to indexing or ingest.");
  }

  return nextSteps;
}

function buildTopLevelPaths(): string[] {
  return [...tenantSkillRepoContract.requiredTopLevelDirectories];
}

function buildRegistryPaths(): string[] {
  return [...tenantSkillRepoContract.requiredRegistryFiles];
}

function buildTopLevelReadme(path: string, heading: string, purpose: string): RepoScaffoldFile {
  return {
    path,
    purpose,
    content: `# ${heading}\n\n${purpose}\n`,
  };
}

function buildBootstrapFiles(request: RepoBootstrapTemplateRequest): RepoScaffoldFile[] {
  const repositorySlug = inferRepositorySlug(request.repoUrl, request.displayName);

  return [
    {
      path: "docs/README.md",
      purpose: "Repository onboarding notes and tenant-specific operating guidance.",
      content: `# ${request.displayName}\n\nThis repository is the tenant-owned source of truth for Savant skills, registry metadata, and retained evaluation assets.\n\n- Repository slug: \`${repositorySlug}\`\n- Default branch: \`${request.defaultBranch}\`\n- Provider: \`${request.provider}\`\n`,
    },
    {
      path: "registry/skills.yaml",
      purpose: "Canonical index of all registered skills in this repository.",
      content: "version: 1\nskills: []\n",
    },
    {
      path: "registry/dependencies.yaml",
      purpose: "Explicit dependency map across skill packages.",
      content: "version: 1\ndependencies: []\n",
    },
    {
      path: "registry/owners.yaml",
      purpose: "Skill owner, reviewer, and escalation metadata.",
      content: "version: 1\nowners: []\n",
    },
    {
      path: "registry/routing-policies.yaml",
      purpose: "Routing policies that define selection precedence and fallbacks.",
      content: "version: 1\npolicies: []\n",
    },
    buildTopLevelReadme(
      "sources/legacy/README.md",
      "Legacy sources",
      "Store migration traceability or imported source references here when needed.",
    ),
    buildTopLevelReadme(
      "tier1/standards/README.md",
      "Tier 1 standards",
      "Place cross-cutting standards and high-governance shared skills here.",
    ),
    buildTopLevelReadme(
      "tier2/methodology/README.md",
      "Tier 2 methodology",
      "Place reusable methodology skills grouped by domain here.",
    ),
    buildTopLevelReadme(
      "tier3/personal/README.md",
      "Tier 3 personal",
      "Place operator-specific personal workflow skills here.",
    ),
    buildTopLevelReadme(
      "tier3/workflow/README.md",
      "Tier 3 workflow",
      "Place narrow shared workflow skills here.",
    ),
    buildTopLevelReadme(
      "evals/README.md",
      "Repository evaluation assets",
      "Keep retained datasets, rubrics, baselines, fixtures, and run artifacts here when they should travel with repository history.",
    ),
    buildTopLevelReadme(
      "scripts/README.md",
      "Repository scripts",
      "Store validation or bootstrap helper scripts here if the tenant needs them.",
    ),
    buildTopLevelReadme(
      "templates/README.md",
      "Repository templates",
      "Store reusable prompts, metadata fragments, or starter examples here.",
    ),
  ];
}

export function validateTenantSkillRepoContract(
  request: RepoContractValidationRequest,
  options?: {
    validationSource?: RepositoryValidationSource | undefined;
  },
): RepoContractValidationPayload {
  const observedPaths =
    request.path === "provision"
      ? buildProvisionObservedPaths(buildBootstrapFiles({
          defaultBranch: request.defaultBranch,
          displayName: request.displayName,
          provider: request.provider,
          repoUrl: request.repoUrl,
          syncMode: request.syncMode,
        }))
      : uniqueNormalizedPaths(request.observedPaths ?? []);
  const hasObservedSnapshot = request.path === "provision" || observedPaths.length > 0;

  const topLevelPaths = buildTopLevelPaths();
  const registryPaths = buildRegistryPaths();
  const observedTopLevels = new Set(observedPaths.map((path) => path.split("/")[0] ?? path));
  const observedPathSet = new Set(observedPaths);

  const missingTopLevelDirectories = hasObservedSnapshot
    ? topLevelPaths.filter((path) => !observedTopLevels.has(path))
    : [];
  const missingRegistryFiles = hasObservedSnapshot
    ? registryPaths.filter((path) => !observedPathSet.has(normalizePath(path)))
    : [];
  const discoveredSkillPackageRoots = inferSkillPackageRoots(observedPaths);
  const providerReadiness = getRepositoryProviderReadiness(request.provider);
  const validationSource = options?.validationSource
    ?? (request.path === "provision"
      ? "bootstrap-template"
      : hasObservedSnapshot
        ? "snapshot-override"
        : "awaiting-provider-preview");

  const checks: RepoContractValidationCheck[] = [
    checkProviderSupport(request),
    checkBranch(request.defaultBranch),
    buildSnapshotCheck(request, observedPaths),
    hasObservedSnapshot
      ? buildTopLevelDirectoryCheck(missingTopLevelDirectories)
      : buildPendingTopLevelDirectoryCheck(),
    hasObservedSnapshot
      ? buildRegistryCheck(missingRegistryFiles)
      : buildPendingRegistryCheck(),
    buildSkillRootsCheck(request, discoveredSkillPackageRoots, hasObservedSnapshot),
    buildEvalScaffoldingCheck(request, observedPaths, hasObservedSnapshot),
  ];

  const ready =
    request.path === "provision"
      ? !checks.some((check) => check.status === "fail")
      : hasObservedSnapshot && !checks.some((check) => check.status === "fail");

  return {
    ready,
    providerReadiness,
    validationSource,
    checks,
    missingTopLevelDirectories,
    missingRegistryFiles,
    discoveredSkillPackageRoots,
    nextSteps: buildNextSteps(
      request,
      ready,
      hasObservedSnapshot,
      missingTopLevelDirectories,
      missingRegistryFiles,
    ),
    summary: {
      observedPathCount: observedPaths.length,
      discoveredSkillPackageCount: discoveredSkillPackageRoots.length,
      missingTopLevelDirectoryCount: missingTopLevelDirectories.length,
      missingRegistryFileCount: missingRegistryFiles.length,
    },
  };
}

export function generateTenantSkillRepoBootstrapTemplate(
  request: RepoBootstrapTemplateRequest,
): RepoBootstrapTemplatePayload {
  const repositorySlug = inferRepositorySlug(request.repoUrl, request.displayName);
  const files = buildBootstrapFiles(request);

  const checks = validateTenantSkillRepoContract({
    path: "provision",
    provider: request.provider,
    repoUrl: request.repoUrl,
    defaultBranch: request.defaultBranch,
    displayName: request.displayName,
    syncMode: request.syncMode,
  });

  return {
    repositorySlug,
    directories: DIRECTORY_PURPOSES,
    files,
    checks: checks.checks,
    nextSteps: checks.nextSteps,
    summary: {
      directoryCount: DIRECTORY_PURPOSES.length,
      fileCount: files.length,
      includesEvalScaffolding: files.some((file) => file.path.startsWith("evals/")),
      includesRegistry: files.some((file) => file.path.startsWith("registry/")),
      includesSkillRoots: DIRECTORY_PURPOSES.some((entry) => entry.path.startsWith("tier1/")),
    },
  };
}

export function summarizeTopLevelPurpose(path: string): string {
  return TOP_LEVEL_PURPOSES[path] ?? "Repository artifact";
}