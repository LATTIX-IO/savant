import { GitProviderError } from "../errors.ts";
import type { Env } from "../secret-vault.ts";
import type { GitProvider, GitProviderType } from "../types.ts";
import { createAzureReposProvider } from "./azure-repos.ts";
import { createBitbucketProvider } from "./bitbucket.ts";
import { createGitHubProvider } from "./github.ts";
import { createGitLabProvider } from "./gitlab.ts";

/**
 * Provider registration. This is the only place that maps a provider type to
 * provider-specific code; everything else talks to the GitProvider contract.
 */
export interface GitProviderRegistry {
  get(type: GitProviderType): GitProvider;
  list(): GitProvider[];
}

export function createGitProviderRegistry(providers: GitProvider[]): GitProviderRegistry {
  const byType = new Map(providers.map((provider) => [provider.type, provider]));

  return {
    get(type) {
      const provider = byType.get(type);
      if (!provider) {
        throw new GitProviderError("PROVIDER_NOT_CONFIGURED", `Git provider '${type}' is not supported.`, { status: 400 });
      }
      return provider;
    },
    list() {
      return [...byType.values()];
    },
  };
}

let defaultRegistry: GitProviderRegistry | null = null;

export function getDefaultGitProviderRegistry(env: Env = process.env): GitProviderRegistry {
  if (!defaultRegistry || env !== process.env) {
    const registry = createGitProviderRegistry([
      createGitHubProvider({ env }),
      createGitLabProvider({ env }),
      createBitbucketProvider({ env }),
      createAzureReposProvider({ env }),
    ]);
    if (env !== process.env) {
      return registry;
    }
    defaultRegistry = registry;
  }

  return defaultRegistry;
}
