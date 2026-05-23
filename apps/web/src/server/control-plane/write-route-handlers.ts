import { NextResponse } from "next/server.js";

import type {
  RepoConnectPayload,
  RepoConnectRequest,
  RepoContractValidationPayload,
  RepoContractValidationRequest,
  RepoProvisionPayload,
  RepoProvisionRequest,
  RepoSyncPayload,
  RepoSyncRequest,
  RepositoryValidationSource,
  SkillScaffoldApplyPayload,
  SkillScaffoldApplyRequest,
} from "@savant/types";

import { createApiErrorResponse, createControlPlaneMeta } from "./control-plane-response.ts";
import type {
  ParsedRepositoryLocator,
  RepositoryProviderMetadata,
} from "./repository-provider.ts";
import {
  readOptionalString,
  readOptionalStringArray,
  readRequiredString,
} from "./request-validation.ts";
import { RepositorySyncError } from "./repository-sync.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";

export type RouteHandledError = {
  code: string;
  status: number;
  message: string;
  details?: string | undefined;
};

type JsonObject = Record<string, unknown>;

type ResolvedRepositoryConnectRequest = {
  locator: ParsedRepositoryLocator;
  metadata?: RepositoryProviderMetadata | undefined;
  validationSource: RepositoryValidationSource;
  request: RepoConnectRequest;
  validationRequest: RepoContractValidationRequest;
};

type ResolvedRepositoryProvisionRequest = {
  locator: ParsedRepositoryLocator;
  request: RepoProvisionRequest;
  validationRequest: RepoContractValidationRequest;
};

function createHandledErrorResponse(error: RouteHandledError) {
  return NextResponse.json(
    createApiErrorResponse(error.code, error.message, error.details),
    { status: error.status },
  );
}

export interface RepositoryConnectRouteHandlerDependencies {
  authorizeTenantRequest(request: Request): Promise<ResolvedTenantContext>;
  readJsonObject(request: Request): Promise<JsonObject | null>;
  resolveRepositoryConnectRequest(
    body: JsonObject,
    options?: {
      signal?: AbortSignal | undefined;
    },
  ): Promise<ResolvedRepositoryConnectRequest>;
  validateTenantSkillRepoContract(
    request: RepoContractValidationRequest,
    options?: {
      validationSource?: RepositoryValidationSource | undefined;
    },
  ): RepoContractValidationPayload;
  connectTenantRepository(input: {
    context: ResolvedTenantContext;
    request: RepoConnectRequest;
    validation: RepoContractValidationPayload;
    locator: ParsedRepositoryLocator;
    metadata?: RepositoryProviderMetadata | undefined;
  }): Promise<RepoConnectPayload>;
  ensureRepositoryWebhookRegistration(input: {
    organizationId: string;
    repositoryId: string;
    provider: RepoConnectRequest["provider"];
    locator: ParsedRepositoryLocator;
    connectionId?: string | undefined;
  }): Promise<{ warning?: string | undefined }>;
  isKnownError(error: unknown): error is RouteHandledError;
}

export function createRepositoryConnectPostHandler(
  deps: RepositoryConnectRouteHandlerDependencies,
) {
  return async function POST(request: Request) {
    try {
      const tenantContext = await deps.authorizeTenantRequest(request);
      const body = await deps.readJsonObject(request);

      if (!body) {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_json_body",
            "Expected a JSON object payload for repository connection.",
          ),
          { status: 400 },
        );
      }

      const resolved = await deps.resolveRepositoryConnectRequest(body, {
        signal: request.signal,
      });
      const validation = deps.validateTenantSkillRepoContract(resolved.validationRequest, {
        validationSource: resolved.validationSource,
      });
      const connected = await deps.connectTenantRepository({
        context: tenantContext,
        request: resolved.request,
        validation,
        locator: resolved.locator,
        metadata: resolved.metadata,
      });
      const warnings: string[] = [];

      if (resolved.request.syncMode === "webhook") {
        const registration = await deps.ensureRepositoryWebhookRegistration({
          organizationId: tenantContext.tenant.organizationId,
          repositoryId: connected.repository.id,
          provider: resolved.request.provider,
          locator: resolved.locator,
          connectionId: resolved.request.connectionId,
        });

        if (registration.warning) {
          warnings.push(registration.warning);
        }
      }

      return NextResponse.json(
        {
          data: {
            ...connected,
            warnings,
          },
          meta: createControlPlaneMeta("database"),
        },
        { status: connected.created ? 201 : 200 },
      );
    } catch (error) {
      if (deps.isKnownError(error)) {
        return createHandledErrorResponse(error);
      }

      throw error;
    }
  };
}

export interface RepositoryProvisionRouteHandlerDependencies {
  authorizeTenantRequest(request: Request): Promise<ResolvedTenantContext>;
  readJsonObject(request: Request): Promise<JsonObject | null>;
  resolveRepositoryProvisionRequest(
    body: JsonObject,
    options?: {
      signal?: AbortSignal | undefined;
    },
  ): Promise<ResolvedRepositoryProvisionRequest>;
  validateTenantSkillRepoContract(
    request: RepoContractValidationRequest,
  ): RepoContractValidationPayload;
  provisionTenantRepository(input: {
    context: ResolvedTenantContext;
    request: RepoProvisionRequest;
    validation: RepoContractValidationPayload;
    locator: ParsedRepositoryLocator;
  }): Promise<RepoProvisionPayload>;
  isKnownError(error: unknown): error is RouteHandledError;
}

export function createRepositoryProvisionPostHandler(
  deps: RepositoryProvisionRouteHandlerDependencies,
) {
  return async function POST(request: Request) {
    try {
      const tenantContext = await deps.authorizeTenantRequest(request);
      const body = await deps.readJsonObject(request);

      if (!body) {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_json_body",
            "Expected a JSON object payload for repository provisioning.",
          ),
          { status: 400 },
        );
      }

      const resolved = await deps.resolveRepositoryProvisionRequest(body, {
        signal: request.signal,
      });
      const validation = deps.validateTenantSkillRepoContract(resolved.validationRequest);
      const data = await deps.provisionTenantRepository({
        context: tenantContext,
        request: resolved.request,
        validation,
        locator: resolved.locator,
      });

      return NextResponse.json(
        {
          data,
          meta: createControlPlaneMeta("mixed"),
        },
        { status: 201 },
      );
    } catch (error) {
      if (deps.isKnownError(error)) {
        return createHandledErrorResponse(error);
      }

      throw error;
    }
  };
}

function resolveRepositorySyncRequest(body: JsonObject): RepoSyncRequest {
  const rawReason = body.reason;

  if (rawReason == null) {
    return {};
  }

  if (typeof rawReason !== "string") {
    throw new RepositorySyncError(
      "repository_sync_reason_invalid",
      "Repository sync reason must be a string when provided.",
      400,
    );
  }

  const reason = rawReason.trim();
  if (reason !== "manual" && reason !== "initial_connect") {
    throw new RepositorySyncError(
      "repository_sync_reason_invalid",
      "Repository sync reason must be 'manual' or 'initial_connect'.",
      400,
    );
  }

  return { reason };
}

export interface RepositorySyncRouteHandlerDependencies {
  authorizeTenantRequest(request: Request): Promise<ResolvedTenantContext>;
  readJsonObject(request: Request): Promise<JsonObject | null>;
  requestTenantRepositorySync(input: {
    context: ResolvedTenantContext;
    repositoryId: string;
    request: RepoSyncRequest;
  }): Promise<RepoSyncPayload>;
  indexTenantRepository(input: {
    context: ResolvedTenantContext;
    repositoryId: string;
    requestedAt: Date;
  }): Promise<RepoSyncPayload>;
  isKnownError(error: unknown): error is RouteHandledError;
}

export function createRepositorySyncPostHandler(
  deps: RepositorySyncRouteHandlerDependencies,
) {
  return async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
  ) {
    try {
      const tenantContext = await deps.authorizeTenantRequest(request);
      const body = await deps.readJsonObject(request);

      if (!body) {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_json_body",
            "Expected a JSON object payload for repository sync requests.",
          ),
          { status: 400 },
        );
      }

      const { id } = await context.params;
      const requested = await deps.requestTenantRepositorySync({
        context: tenantContext,
        repositoryId: id,
        request: resolveRepositorySyncRequest(body),
      });
      const data = requested.accepted
        ? await deps.indexTenantRepository({
            context: tenantContext,
            repositoryId: id,
            requestedAt: new Date(requested.requestedAt),
          })
        : requested;

      return NextResponse.json(
        {
          data,
          meta: createControlPlaneMeta("database"),
        },
        { status: 200 },
      );
    } catch (error) {
      if (deps.isKnownError(error)) {
        return createHandledErrorResponse(error);
      }

      throw error;
    }
  };
}

export interface SkillScaffoldApplyRouteHandlerDependencies {
  authorizeTenantRequest(request: Request): Promise<ResolvedTenantContext>;
  readJsonObject(request: Request): Promise<JsonObject | null>;
  applySkillScaffoldToRepository(input: {
    context: ResolvedTenantContext;
    request: SkillScaffoldApplyRequest;
  }): Promise<SkillScaffoldApplyPayload>;
  isKnownError(error: unknown): error is RouteHandledError;
}

export function createSkillScaffoldApplyPostHandler(
  deps: SkillScaffoldApplyRouteHandlerDependencies,
) {
  return async function POST(request: Request) {
    try {
      const tenantContext = await deps.authorizeTenantRequest(request);
      const body = await deps.readJsonObject(request);

      if (!body) {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_json_body",
            "Expected a JSON object payload for skill scaffold apply.",
          ),
          { status: 400 },
        );
      }

      const repositoryId = readRequiredString(body, "repositoryId", 100);
      const displayName = readRequiredString(body, "displayName", 160);
      const tier = readRequiredString(body, "tier", 20);
      const owner = readRequiredString(body, "owner", 120);
      const summary = readRequiredString(body, "summary", 400);
      const tier3Kind = readOptionalString(body, "tier3Kind", 40);
      const status = readOptionalString(body, "status", 30);

      if (!repositoryId || !displayName || !owner || !summary || !tier) {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_skill_scaffold_apply_request",
            "Skill scaffold apply requires repositoryId, displayName, tier, owner, and summary.",
          ),
          { status: 400 },
        );
      }

      if (tier !== "tier1" && tier !== "tier2" && tier !== "tier3") {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_skill_tier",
            "Skill scaffold apply requires tier1, tier2, or tier3.",
          ),
          { status: 400 },
        );
      }

      if (tier3Kind && tier3Kind !== "personal" && tier3Kind !== "workflow") {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_tier3_kind",
            "Skill scaffold apply tier3Kind must be personal or workflow.",
          ),
          { status: 400 },
        );
      }

      if (status && status !== "draft" && status !== "active" && status !== "deprecated") {
        return NextResponse.json(
          createApiErrorResponse(
            "invalid_skill_status",
            "Skill scaffold apply status must be draft, active, or deprecated.",
          ),
          { status: 400 },
        );
      }

      const data = await deps.applySkillScaffoldToRepository({
        context: tenantContext,
        request: {
          repositoryId,
          connectionId: readOptionalString(body, "connectionId", 100),
          displayName,
          tier,
          owner,
          summary,
          skillId: readOptionalString(body, "skillId", 200),
          packagePath: readOptionalString(body, "packagePath", 240),
          domain: readOptionalString(body, "domain", 100),
          category: readOptionalString(body, "category", 100),
          personSlug: readOptionalString(body, "personSlug", 100),
          tier3Kind: tier3Kind === "personal" || tier3Kind === "workflow" ? tier3Kind : undefined,
          version: readOptionalString(body, "version", 30),
          status: status === "draft" || status === "active" || status === "deprecated" ? status : undefined,
          dependencies: readOptionalStringArray(body, "dependencies"),
        },
      });

      return NextResponse.json(
        {
          data,
          meta: createControlPlaneMeta("mixed"),
        },
        { status: 201 },
      );
    } catch (error) {
      if (deps.isKnownError(error)) {
        return createHandledErrorResponse(error);
      }

      throw error;
    }
  };
}
