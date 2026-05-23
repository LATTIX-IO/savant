import type { GitProvider } from "@savant/types";

import type { FetchLike } from "./repository-provider-read.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";
import { createGitHubAuthenticatedFetch } from "./repository-provider-github-write.ts";
import { createGitLabAuthenticatedFetch } from "./repository-provider-gitlab-write.ts";

export function createProviderAuthenticatedFetch(
  provider: GitProvider,
  token: string,
  baseFetcher: FetchLike = fetch,
): FetchLike {
  switch (provider) {
    case "github":
      return createGitHubAuthenticatedFetch(token, baseFetcher);
    case "gitlab":
      return createGitLabAuthenticatedFetch(token, baseFetcher);
    default:
      throw new RepositoryProviderError(
        "repository_provider_authenticated_fetch_unsupported",
        `Provider-backed authenticated fetch is not wired for '${provider}' in the current MVP.`,
        409,
      );
  }
}
