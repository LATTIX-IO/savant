import type { GitProvider } from "@savant/types";

import { getRepositoryProviderCapabilities } from "./repository-provider.ts";
import { readGitHubRepositoryIndexSnapshot, readGitHubRepositoryPreview } from "./repository-provider-github.ts";
import { readGitLabRepositoryIndexSnapshot, readGitLabRepositoryPreview } from "./repository-provider-gitlab.ts";
import {
  RepositoryProviderError,
  type RepositoryProviderReadAdapter,
} from "./repository-provider-read.ts";

const REGISTERED_REPOSITORY_READ_ADAPTERS = new Map<GitProvider, RepositoryProviderReadAdapter>([
  [
    "github",
    {
      provider: "github",
      readRepositoryPreview: readGitHubRepositoryPreview,
      readRepositoryIndexSnapshot: readGitHubRepositoryIndexSnapshot,
    },
  ],
  [
    "gitlab",
    {
      provider: "gitlab",
      readRepositoryPreview: readGitLabRepositoryPreview,
      readRepositoryIndexSnapshot: readGitLabRepositoryIndexSnapshot,
    },
  ],
]);

function createUnsupportedRepositoryReadAdapter(provider: GitProvider): RepositoryProviderReadAdapter {
  const capabilities = getRepositoryProviderCapabilities(provider);
  const previewMessage = capabilities.canReadTree
    ? `Live repository preview for '${provider}' is not wired in the current MVP yet.`
    : `Provider '${provider}' does not support live repository preview in the current MVP.`;
  const indexMessage = capabilities.canReadTree
    ? "Live repository indexing is production-ready for GitHub and GitLab in the current MVP. Other providers can still use contract preview flows while provider-backed indexing lands."
    : `Provider '${provider}' does not support live repository indexing in the current MVP.`;

  return {
    provider,
    async readRepositoryPreview() {
      throw new RepositoryProviderError(
        "repository_provider_preview_unsupported",
        previewMessage,
        409,
      );
    },
    async readRepositoryIndexSnapshot() {
      throw new RepositoryProviderError(
        "repository_provider_index_unsupported",
        indexMessage,
        409,
      );
    },
  };
}

export function hasRegisteredRepositoryReadAdapter(provider: GitProvider): boolean {
  return REGISTERED_REPOSITORY_READ_ADAPTERS.has(provider);
}

export function resolveRepositoryReadAdapter(provider: GitProvider): RepositoryProviderReadAdapter {
  return REGISTERED_REPOSITORY_READ_ADAPTERS.get(provider) ?? createUnsupportedRepositoryReadAdapter(provider);
}