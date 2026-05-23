import type {
  RepoConnectRequest,
  RepoContractValidationRequest,
  RepoProvisionRequest,
  RepositoryOnboardingPath,
  RepositorySyncMode,
  RepositoryVisibility,
  RepositoryValidationSource,
} from "@savant/types";

import {
  type ParsedRepositoryLocator,
  type RepositoryProviderMetadata,
  isConcreteRepositoryProvider,
  parseRepositoryLocator,
} from "./repository-provider.ts";
import { hasRegisteredRepositoryReadAdapter, resolveRepositoryReadAdapter } from "./repository-provider-read-adapter.ts";
import {
  readOptionalString,
  readOptionalStringArray,
  readRequiredString,
} from "./request-validation.ts";

type JsonObject = Record<string, unknown>;

type ResolvedRepositoryRequestBase = {
  locator: ParsedRepositoryLocator;
  metadata?: RepositoryProviderMetadata | undefined;
  validationSource: RepositoryValidationSource;
  connectionId?: string | undefined;
  request: Omit<RepoContractValidationRequest, "path">;
};

export class RepositoryRequestError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "RepositoryRequestError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function parseSyncMode(body: JsonObject): RepositorySyncMode | undefined {
  const syncMode = readOptionalString(body, "syncMode", 20);

  if (!syncMode) {
    return undefined;
  }

  if (syncMode === "webhook") {
    throw new RepositoryRequestError(
      "repository_sync_mode_disabled",
      "Webhook sync is disabled in the current secure MVP. Use poll or manual sync.",
      409,
    );
  }

  if (syncMode === "poll" || syncMode === "manual") {
    return syncMode;
  }

  throw new RepositoryRequestError(
    "invalid_sync_mode",
    "Repository syncMode must be poll or manual.",
    400,
  );
}

function parseRepositoryVisibility(body: JsonObject): RepositoryVisibility | undefined {
  const visibility = readOptionalString(body, "visibility", 20);

  if (!visibility) {
    return undefined;
  }

  if (visibility === "private" || visibility === "internal" || visibility === "public") {
    return visibility;
  }

  throw new RepositoryRequestError(
    "invalid_repository_visibility",
    "Repository visibility must be private, internal, or public when provided.",
    400,
  );
}

async function resolveRepositoryRequestBase(
  body: JsonObject,
  options: {
    path: RepositoryOnboardingPath;
    signal?: AbortSignal | undefined;
  },
): Promise<ResolvedRepositoryRequestBase> {
  const provider = readRequiredString(body, "provider", 60)?.toLowerCase();
  const repoUrl = readRequiredString(body, "repoUrl", 400);
  const defaultBranch = readRequiredString(body, "defaultBranch", 100);
  const displayName = readRequiredString(body, "displayName", 120);
  const connectionId = readOptionalString(body, "connectionId", 100);
  const syncMode = parseSyncMode(body);

  if (!provider || !repoUrl || !defaultBranch || !displayName) {
    throw new RepositoryRequestError(
      "invalid_repository_request",
      "Repository requests require provider, repoUrl, defaultBranch, and displayName.",
      400,
    );
  }

  if (!isConcreteRepositoryProvider(provider)) {
    throw new RepositoryRequestError(
      "invalid_repository_provider",
      "Repository requests require a supported concrete provider identifier.",
      400,
    );
  }

  const locator = parseRepositoryLocator({ provider, repoUrl });

  if (!locator?.owner || !locator.repository) {
    throw new RepositoryRequestError(
      "invalid_repository_locator",
      "Repository requests require a provider-compatible repository URL or locator.",
      400,
    );
  }

  let resolvedDefaultBranch = defaultBranch;
  const providedObservedPaths = readOptionalStringArray(body, "observedPaths");
  let resolvedObservedPaths = providedObservedPaths;
  let metadata: RepositoryProviderMetadata | undefined;
  let validationSource: RepositoryValidationSource = options.path === "provision"
    ? "bootstrap-template"
    : providedObservedPaths && providedObservedPaths.length > 0
      ? "snapshot-override"
      : "awaiting-provider-preview";

  if (
    options.path === "connect"
    && hasRegisteredRepositoryReadAdapter(provider)
    && (!resolvedObservedPaths || resolvedObservedPaths.length === 0)
  ) {
    const preview = await resolveRepositoryReadAdapter(provider).readRepositoryPreview(locator, {
      signal: options.signal,
    });

    resolvedDefaultBranch = preview.metadata.defaultBranch;
    resolvedObservedPaths = preview.observedPaths;
    metadata = preview.metadata;
    validationSource = "provider-live-preview";
  }

  return {
    locator,
    metadata,
    validationSource,
    connectionId,
    request: {
      provider,
      repoUrl: locator.normalizedUrl,
      defaultBranch: resolvedDefaultBranch,
      displayName,
      syncMode,
      observedPaths: resolvedObservedPaths,
    },
  };
}

export async function resolveRepositoryValidationRequest(
  body: JsonObject,
  options?: {
    signal?: AbortSignal | undefined;
  },
): Promise<{
  locator: ParsedRepositoryLocator;
  metadata?: RepositoryProviderMetadata | undefined;
  validationSource: RepositoryValidationSource;
  request: RepoContractValidationRequest;
}> {
  const path = readRequiredString(body, "path", 40);

  if (!path || (path !== "connect" && path !== "provision")) {
    throw new RepositoryRequestError(
      "invalid_repository_path",
      "Repository validation requires a path of 'connect' or 'provision'.",
      400,
    );
  }

  const resolved = await resolveRepositoryRequestBase(body, {
    path,
    signal: options?.signal,
  });

  return {
    locator: resolved.locator,
    metadata: resolved.metadata,
    validationSource: resolved.validationSource,
    request: {
      path,
      ...resolved.request,
    },
  };
}

export async function resolveRepositoryConnectRequest(
  body: JsonObject,
  options?: {
    signal?: AbortSignal | undefined;
  },
): Promise<{
  locator: ParsedRepositoryLocator;
  metadata?: RepositoryProviderMetadata | undefined;
  validationSource: RepositoryValidationSource;
  request: RepoConnectRequest;
  validationRequest: RepoContractValidationRequest;
}> {
  const resolved = await resolveRepositoryRequestBase(body, {
    path: "connect",
    signal: options?.signal,
  });

  return {
    locator: resolved.locator,
    metadata: resolved.metadata,
    validationSource: resolved.validationSource,
    request: {
      ...resolved.request,
      connectionId: resolved.connectionId,
    },
    validationRequest: {
      path: "connect",
      ...resolved.request,
    },
  };
}

export async function resolveRepositoryProvisionRequest(
  body: JsonObject,
  options?: {
    signal?: AbortSignal | undefined;
  },
): Promise<{
  locator: ParsedRepositoryLocator;
  request: RepoProvisionRequest;
  validationRequest: RepoContractValidationRequest;
}> {
  const resolved = await resolveRepositoryRequestBase(body, {
    path: "provision",
    signal: options?.signal,
  });

  return {
    locator: resolved.locator,
    request: {
      ...resolved.request,
      connectionId: resolved.connectionId,
      visibility: parseRepositoryVisibility(body),
    },
    validationRequest: {
      path: "provision",
      ...resolved.request,
    },
  };
}
