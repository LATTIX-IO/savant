import type { GitProvider } from "./control-plane";

export type RepositoryProviderSupportedSyncMode = "webhook" | "poll" | "manual";

export type RepositoryValidationSource =
  | "provider-live-preview"
  | "snapshot-override"
  | "awaiting-provider-preview"
  | "bootstrap-template";

export type RepositoryReadinessReasonCode =
  | "available"
  | "manual_snapshot_required"
  | "indexing_unavailable"
  | "webhook_registration_unavailable"
  | "provisioning_writes_unavailable";

export interface RepositoryProviderSupportExplanation {
  reasonCode: RepositoryReadinessReasonCode;
  message: string;
}

export interface RepositoryProviderReadiness {
  provider: GitProvider;
  supportsLiveTreePreview: boolean;
  supportsImmediateIndexing: boolean;
  indexingSupported: boolean;
  supportedSyncModes: RepositoryProviderSupportedSyncMode[];
  supportsWebhookRegistration: boolean;
  supportsProvisioningWrites: boolean;
  liveTreePreview: RepositoryProviderSupportExplanation;
  immediateIndexing: RepositoryProviderSupportExplanation;
  webhookRegistration: RepositoryProviderSupportExplanation;
  provisioningWrites: RepositoryProviderSupportExplanation;
}

type RepositoryProviderReadinessMapEntry = Omit<RepositoryProviderReadiness, "provider">;

function createExplanation(
  reasonCode: RepositoryReadinessReasonCode,
  message: string,
): RepositoryProviderSupportExplanation {
  return { reasonCode, message };
}

const DEFAULT_PROVIDER_READINESS: RepositoryProviderReadinessMapEntry = {
  supportsLiveTreePreview: false,
  supportsImmediateIndexing: false,
  indexingSupported: false,
  supportedSyncModes: ["manual"],
  supportsWebhookRegistration: false,
  supportsProvisioningWrites: false,
  liveTreePreview: createExplanation(
    "manual_snapshot_required",
    "Paste a repository path snapshot to validate this provider while live preview support lands.",
  ),
  immediateIndexing: createExplanation(
    "indexing_unavailable",
    "Immediate indexing is not wired for this provider in the current secure MVP yet.",
  ),
  webhookRegistration: createExplanation(
    "webhook_registration_unavailable",
    "Webhook sync is disabled for this provider in the current secure MVP.",
  ),
  provisioningWrites: createExplanation(
    "provisioning_writes_unavailable",
    "GitHub is the only provider-backed provisioning and scaffold/apply target in the current secure MVP.",
  ),
};

const REPOSITORY_PROVIDER_READINESS: Record<string, RepositoryProviderReadinessMapEntry> = {
  github: {
    supportsLiveTreePreview: true,
    supportsImmediateIndexing: true,
    indexingSupported: true,
    supportedSyncModes: ["poll", "manual"],
    supportsWebhookRegistration: false,
    supportsProvisioningWrites: true,
    liveTreePreview: createExplanation(
      "available",
      "Savant can preview public GitHub repositories live in the current secure MVP.",
    ),
    immediateIndexing: createExplanation(
      "available",
      "GitHub repositories are indexed immediately after connect in the current secure MVP.",
    ),
    webhookRegistration: createExplanation(
      "webhook_registration_unavailable",
      "GitHub webhook sync is disabled for the current secure MVP; use poll or manual sync.",
    ),
    provisioningWrites: createExplanation(
      "available",
      "GitHub repository provisioning and scaffold/apply writes are available in the current secure MVP.",
    ),
  },
  gitlab: {
    supportsLiveTreePreview: true,
    supportsImmediateIndexing: true,
    indexingSupported: true,
    supportedSyncModes: ["poll", "manual"],
    supportsWebhookRegistration: false,
    supportsProvisioningWrites: false,
    liveTreePreview: createExplanation(
      "available",
      "Savant can preview public GitLab repositories live in the current secure MVP.",
    ),
    immediateIndexing: createExplanation(
      "available",
      "GitLab repositories are indexed immediately after connect in the current secure MVP.",
    ),
    webhookRegistration: createExplanation(
      "webhook_registration_unavailable",
      "GitLab webhook sync is disabled for the current secure MVP; use poll or manual sync.",
    ),
    provisioningWrites: createExplanation(
      "provisioning_writes_unavailable",
      "GitHub is the only provider-backed provisioning and scaffold/apply target in the current secure MVP.",
    ),
  },
  azure: DEFAULT_PROVIDER_READINESS,
  bitbucket: DEFAULT_PROVIDER_READINESS,
  selfhosted: DEFAULT_PROVIDER_READINESS,
  more: DEFAULT_PROVIDER_READINESS,
};

function cloneReadiness(
  provider: GitProvider,
  readiness: RepositoryProviderReadinessMapEntry,
): RepositoryProviderReadiness {
  return {
    provider,
    supportsLiveTreePreview: readiness.supportsLiveTreePreview,
    supportsImmediateIndexing: readiness.supportsImmediateIndexing,
    indexingSupported: readiness.indexingSupported,
    supportedSyncModes: [...readiness.supportedSyncModes],
    supportsWebhookRegistration: readiness.supportsWebhookRegistration,
    supportsProvisioningWrites: readiness.supportsProvisioningWrites,
    liveTreePreview: { ...readiness.liveTreePreview },
    immediateIndexing: { ...readiness.immediateIndexing },
    webhookRegistration: { ...readiness.webhookRegistration },
    provisioningWrites: { ...readiness.provisioningWrites },
  };
}

export function getRepositoryProviderReadiness(provider: GitProvider): RepositoryProviderReadiness {
  const readiness = REPOSITORY_PROVIDER_READINESS[provider] ?? DEFAULT_PROVIDER_READINESS;
  return cloneReadiness(provider, readiness);
}

export function supportsRepositorySyncMode(
  readinessOrProvider: RepositoryProviderReadiness | GitProvider,
  syncMode: RepositoryProviderSupportedSyncMode,
): boolean {
  const readiness = typeof readinessOrProvider === "string"
    ? getRepositoryProviderReadiness(readinessOrProvider)
    : readinessOrProvider;

  return readiness.supportedSyncModes.includes(syncMode);
}

export function getPreferredRepositorySyncMode(
  readinessOrProvider: RepositoryProviderReadiness | GitProvider,
): RepositoryProviderSupportedSyncMode {
  const readiness = typeof readinessOrProvider === "string"
    ? getRepositoryProviderReadiness(readinessOrProvider)
    : readinessOrProvider;

  return readiness.supportedSyncModes[0] ?? "manual";
}
