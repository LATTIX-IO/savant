import type { GitProvider } from "@savant/types";

import type {
  ParsedRepositoryLocator,
  RepositoryProviderMetadata,
} from "./repository-provider.ts";

export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface RepositoryProviderPreview {
  metadata: RepositoryProviderMetadata;
  observedPaths: string[];
}

export interface RepositoryProviderIndexSnapshot {
  metadata?: RepositoryProviderMetadata | undefined;
  defaultBranch: string;
  commitSha: string;
  observedPaths: string[];
  files: Record<string, string>;
}

export interface RepositoryProviderReadOptions {
  fetcher?: FetchLike | undefined;
  signal?: AbortSignal | undefined;
}

export interface RepositoryProviderIndexReadOptions extends RepositoryProviderReadOptions {
  branch?: string | undefined;
}

export interface RepositoryProviderReadAdapter {
  readonly provider: GitProvider;
  readRepositoryPreview(
    locator: ParsedRepositoryLocator,
    options?: RepositoryProviderReadOptions,
  ): Promise<RepositoryProviderPreview>;
  readRepositoryIndexSnapshot(
    locator: ParsedRepositoryLocator,
    options?: RepositoryProviderIndexReadOptions,
  ): Promise<RepositoryProviderIndexSnapshot>;
}

export class RepositoryProviderError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status: number, details?: string) {
    super(message);
    this.name = "RepositoryProviderError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}