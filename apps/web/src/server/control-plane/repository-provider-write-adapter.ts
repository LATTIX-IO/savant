import type { GitProvider } from "@savant/types";

import type { FetchLike } from "./repository-provider-read.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";
import type { RepositoryProviderAdapter } from "./repository-provider.ts";
import { getRepositoryProviderCapabilities } from "./repository-provider.ts";
import { createGitHubRepositoryProviderAdapter } from "./repository-provider-github-write.ts";
import { createGitLabRepositoryProviderAdapter } from "./repository-provider-gitlab-write.ts";

type RepositoryProviderAdapterFactory = (options?: {
  fetcher?: FetchLike | undefined;
  env?: Record<string, string | undefined> | undefined;
}) => RepositoryProviderAdapter;

type RepositoryWriteAdapterRegistration = {
  createAdapter: RepositoryProviderAdapterFactory;
  supportsProvisioningWrites: boolean;
  supportsWebhookRegistration: boolean;
};

const REGISTERED_REPOSITORY_WRITE_ADAPTERS = new Map<GitProvider, RepositoryWriteAdapterRegistration>([
  ["github", {
    createAdapter: createGitHubRepositoryProviderAdapter,
    supportsProvisioningWrites: true,
    supportsWebhookRegistration: false,
  }],
  ["gitlab", {
    createAdapter: createGitLabRepositoryProviderAdapter,
    supportsProvisioningWrites: false,
    supportsWebhookRegistration: false,
  }],
]);

function createUnsupportedRepositoryWriteAdapter(provider: GitProvider): RepositoryProviderAdapter {
  const capabilities = getRepositoryProviderCapabilities(provider);
  const mutationMessage = capabilities.canCreateCommit || capabilities.canCreateRepository
    ? `Provider-backed repository writes for '${provider}' are not wired in the current MVP yet.`
    : `Provider '${provider}' does not support provider-backed repository writes in the current MVP.`;

  return {
    provider,
    capabilities,
    async resolveRepository() {
      throw new RepositoryProviderError(
        "repository_provider_write_unsupported",
        mutationMessage,
        409,
      );
    },
    async readRepositoryTree() {
      throw new RepositoryProviderError(
        "repository_provider_write_unsupported",
        mutationMessage,
        409,
      );
    },
    async createRepository() {
      throw new RepositoryProviderError(
        "repository_provider_create_unsupported",
        mutationMessage,
        409,
      );
    },
    async createCommit() {
      throw new RepositoryProviderError(
        "repository_provider_commit_unsupported",
        mutationMessage,
        409,
      );
    },
    async registerWebhook() {
      throw new RepositoryProviderError(
        "repository_provider_webhook_unsupported",
        mutationMessage,
        409,
      );
    },
  };
}

export function hasRegisteredRepositoryWriteAdapter(provider: GitProvider): boolean {
  return REGISTERED_REPOSITORY_WRITE_ADAPTERS.has(provider);
}

export function supportsRepositoryProvisioningWrites(provider: GitProvider): boolean {
  return REGISTERED_REPOSITORY_WRITE_ADAPTERS.get(provider)?.supportsProvisioningWrites ?? false;
}

export function supportsRepositoryWebhookRegistration(provider: GitProvider): boolean {
  return REGISTERED_REPOSITORY_WRITE_ADAPTERS.get(provider)?.supportsWebhookRegistration ?? false;
}

export function resolveRepositoryWriteAdapter(
  provider: GitProvider,
  options?: {
    fetcher?: FetchLike | undefined;
    env?: Record<string, string | undefined> | undefined;
  },
): RepositoryProviderAdapter {
  return REGISTERED_REPOSITORY_WRITE_ADAPTERS.get(provider)?.createAdapter(options)
    ?? createUnsupportedRepositoryWriteAdapter(provider);
}