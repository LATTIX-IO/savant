import type { GitProvider } from "@savant/types";

export type KnownRepositoryProvider =
  | "github"
  | "gitlab"
  | "azure"
  | "bitbucket"
  | "selfhosted"
  | "more";

export type ConcreteRepositoryProvider = Exclude<KnownRepositoryProvider, "more">;

export type RepositoryTreeEntryKind = "file" | "dir";

export interface RepositoryProviderCapabilities {
  canReadTree: boolean;
  canResolveRefs: boolean;
  canCreateRepository: boolean;
  canCreateCommit: boolean;
  canRegisterWebhooks: boolean;
  supportsManagedProvisioning: boolean;
  supportsWebhookSync: boolean;
}

export interface ParsedRepositoryLocator {
  provider: GitProvider;
  rawUrl: string;
  normalizedUrl: string;
  host: string;
  owner: string | null;
  repository: string | null;
  projectPath: string;
}

export interface RepositoryProviderMetadata {
  externalId: string;
  defaultBranch: string;
  displayName: string;
  visibility: "private" | "internal" | "public" | "unknown";
}

export interface RepositoryTreeEntry {
  path: string;
  kind: RepositoryTreeEntryKind;
}

export interface RepositoryCreateRepositoryInput {
  owner?: string | undefined;
  name: string;
  defaultBranch: string;
  description?: string | undefined;
  visibility: "private" | "internal" | "public";
  baseUrl?: string | undefined;
}

export interface RepositoryCommitFileWrite {
  path: string;
  content: string;
}

export interface RepositoryCommitResult {
  commitSha: string;
  committedAt: string;
  url: string | null;
  changedPaths: string[];
}

export interface RepositoryWebhookRegistration {
  id: string;
  url: string;
  events: string[];
  secretRef: string | null;
}

export interface RepositoryProviderAdapter {
  readonly provider: GitProvider;
  readonly capabilities: RepositoryProviderCapabilities;
  resolveRepository(
    locator: ParsedRepositoryLocator,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<RepositoryProviderMetadata>;
  readRepositoryTree(
    locator: ParsedRepositoryLocator,
    options?: { ref?: string | undefined; signal?: AbortSignal | undefined },
  ): Promise<RepositoryTreeEntry[]>;
  createRepository(
    input: RepositoryCreateRepositoryInput,
    options?: { signal?: AbortSignal | undefined },
  ): Promise<RepositoryProviderMetadata & { normalizedUrl: string }>;
  createCommit(
    locator: ParsedRepositoryLocator,
    input: {
      branch: string;
      message: string;
      files: RepositoryCommitFileWrite[];
    },
    options?: { signal?: AbortSignal | undefined },
  ): Promise<RepositoryCommitResult>;
  registerWebhook(
    locator: ParsedRepositoryLocator,
    input: {
      callbackUrl: string;
      secretRef: string | null;
      events: string[];
    },
    options?: { signal?: AbortSignal | undefined },
  ): Promise<RepositoryWebhookRegistration>;
}

const KNOWN_REPOSITORY_PROVIDERS: readonly KnownRepositoryProvider[] = [
  "github",
  "gitlab",
  "azure",
  "bitbucket",
  "selfhosted",
  "more",
];

const CONCRETE_REPOSITORY_PROVIDERS: readonly ConcreteRepositoryProvider[] = [
  "github",
  "gitlab",
  "azure",
  "bitbucket",
  "selfhosted",
];

const DEFAULT_PROVIDER_CAPABILITIES: Record<KnownRepositoryProvider, RepositoryProviderCapabilities> = {
  github: {
    canReadTree: true,
    canResolveRefs: true,
    canCreateRepository: true,
    canCreateCommit: true,
    canRegisterWebhooks: false,
    supportsManagedProvisioning: true,
    supportsWebhookSync: false,
  },
  gitlab: {
    canReadTree: true,
    canResolveRefs: true,
    canCreateRepository: false,
    canCreateCommit: false,
    canRegisterWebhooks: false,
    supportsManagedProvisioning: false,
    supportsWebhookSync: false,
  },
  azure: {
    canReadTree: true,
    canResolveRefs: true,
    canCreateRepository: false,
    canCreateCommit: false,
    canRegisterWebhooks: false,
    supportsManagedProvisioning: false,
    supportsWebhookSync: false,
  },
  bitbucket: {
    canReadTree: true,
    canResolveRefs: true,
    canCreateRepository: false,
    canCreateCommit: false,
    canRegisterWebhooks: false,
    supportsManagedProvisioning: false,
    supportsWebhookSync: false,
  },
  selfhosted: {
    canReadTree: true,
    canResolveRefs: true,
    canCreateRepository: false,
    canCreateCommit: false,
    canRegisterWebhooks: false,
    supportsManagedProvisioning: false,
    supportsWebhookSync: false,
  },
  more: {
    canReadTree: true,
    canResolveRefs: true,
    canCreateRepository: false,
    canCreateCommit: false,
    canRegisterWebhooks: false,
    supportsManagedProvisioning: false,
    supportsWebhookSync: false,
  },
};

function buildNormalizedUrl(protocol: string, host: string, path: string): string | null {
  if (!host || !path) {
    return null;
  }

  const normalizedProtocol = protocol.toLowerCase();

  if (normalizedProtocol !== "http:" && normalizedProtocol !== "https:") {
    return null;
  }

  return `${normalizedProtocol}//${host.toLowerCase()}/${path}`;
}

function normalizePathname(pathname: string): string {
  return pathname
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .replace(/\/+/g, "/");
}

function normalizeHost(url: URL): string {
  return url.port ? `${url.hostname.toLowerCase()}:${url.port}` : url.hostname.toLowerCase();
}

function parseStandardRepositorySegments(segments: readonly string[]) {
  if (segments.length < 2) {
    return { owner: null, repository: null };
  }

  return {
    owner: segments.slice(0, -1).join("/"),
    repository: segments.at(-1) ?? null,
  };
}

function parseAzureRepositorySegments(segments: readonly string[]) {
  const gitIndex = segments.findIndex((segment) => segment.toLowerCase() === "_git");

  if (gitIndex < 1 || gitIndex >= segments.length - 1) {
    return { owner: null, repository: null };
  }

  return {
    owner: segments.slice(0, gitIndex).join("/"),
    repository: segments[gitIndex + 1] ?? null,
  };
}

export function isKnownRepositoryProvider(provider: string): provider is KnownRepositoryProvider {
  return KNOWN_REPOSITORY_PROVIDERS.includes(provider as KnownRepositoryProvider);
}

export function isConcreteRepositoryProvider(provider: string): provider is ConcreteRepositoryProvider {
  return CONCRETE_REPOSITORY_PROVIDERS.includes(provider as ConcreteRepositoryProvider);
}

export function getRepositoryProviderCapabilities(provider: GitProvider): RepositoryProviderCapabilities {
  return isKnownRepositoryProvider(provider)
    ? DEFAULT_PROVIDER_CAPABILITIES[provider]
    : DEFAULT_PROVIDER_CAPABILITIES.more;
}

export function normalizeRepositoryUrl(value: string): string | null {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const sshMatch = /^git@([^:]+):(.+)$/i.exec(trimmed);

  if (sshMatch) {
    const host = sshMatch[1]?.trim().toLowerCase();
    const path = normalizePathname(sshMatch[2] ?? "");

    return host ? buildNormalizedUrl("https:", host, path) : null;
  }

  const withScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, "")}`;

  try {
    const parsed = new URL(withScheme);
    const normalizedPath = normalizePathname(parsed.pathname);

    return buildNormalizedUrl(parsed.protocol, normalizeHost(parsed), normalizedPath);
  } catch {
    return null;
  }
}

export function parseRepositoryLocator(input: {
  provider: GitProvider;
  repoUrl: string;
}): ParsedRepositoryLocator | null {
  const normalizedUrl = normalizeRepositoryUrl(input.repoUrl);

  if (!normalizedUrl) {
    return null;
  }

  const parsedUrl = new URL(normalizedUrl);
  const segments = normalizePathname(parsedUrl.pathname)
    .split("/")
    .filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const parsedSegments = input.provider === "azure"
    ? parseAzureRepositorySegments(segments)
    : parseStandardRepositorySegments(segments);

  if (!parsedSegments.repository) {
    return null;
  }

  return {
    provider: input.provider,
    rawUrl: input.repoUrl,
    normalizedUrl,
    host: normalizeHost(parsedUrl),
    owner: parsedSegments.owner,
    repository: parsedSegments.repository,
    projectPath: segments.join("/"),
  };
}