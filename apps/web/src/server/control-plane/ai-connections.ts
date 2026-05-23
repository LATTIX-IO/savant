import { randomUUID } from "node:crypto";
import type { TransactionSql } from "postgres";

import type {
  AIConnectionCreateRequest,
  AIConnectionRotateRequest,
  AIConnectionSetDefaultRequest,
  AIConnectionSummary,
  AIProviderId,
} from "@savant/types";

import {
  AIConnectionSecretStoreError,
  encryptAIConnectionSecret,
} from "./ai-connection-secrets.ts";
import { formatRelativeControlPlaneTime } from "./read-model-db.ts";
import { requireTenantAdminActor } from "./tenant-authorization.ts";
import type { ResolvedTenantContext } from "./tenant-context.ts";

const SUPPORTED_AI_PROVIDERS = new Set<string>([
  "openai",
  "anthropic",
  "azure-openai",
  "openai-compatible",
]);
const PROVIDERS_REQUIRING_BASE_URL = new Set<string>(["azure-openai", "openai-compatible"]);
const ROTATION_WARNING_DAYS = 75;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

type AIConnectionConfig = {
  baseUrl?: string | undefined;
  apiVersion?: string | undefined;
};

type AIConnectionRow = {
  id: string;
  providerType: string;
  displayName: string;
  defaultModel: string;
  purpose: string;
  usageScope: string;
  supportsExecution: boolean;
  supportsJudging: boolean;
  isDefaultExecution: boolean;
  isDefaultJudge: boolean;
  status: string;
  secretRef: string;
  lastUsedAt: Date | string | null;
  lastRotatedAt: Date | string | null;
  config: AIConnectionConfig | null;
};

type NormalizedAIConnectionCreateRequest = {
  provider: AIProviderId;
  label: string;
  defaultModel: string;
  purpose: string;
  usageScope: string;
  apiKey: string;
  allowedModels: string[];
  supportsExecution: boolean;
  supportsJudging: boolean;
  isDefaultExecution: boolean;
  isDefaultJudge: boolean;
  baseUrl?: string | undefined;
  apiVersion?: string | undefined;
};

type NormalizedAIConnectionRotateRequest = {
  apiKey: string;
  defaultModel?: string | undefined;
  purpose?: string | undefined;
  usageScope?: string | undefined;
  allowedModels?: string[] | undefined;
  baseUrl?: string | undefined;
  apiVersion?: string | undefined;
};

type DatabaseErrorLike = {
  code?: string;
};

export class AIConnectionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "AIConnectionError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function isDatabaseErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && (error as DatabaseErrorLike).code === code;
}

function isSupportedAIProvider(provider: string): provider is AIProviderId {
  return SUPPORTED_AI_PROVIDERS.has(provider);
}

function normalizeRequiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new AIConnectionError(
      `${field}_required`,
      `${field} is required for a BYO-AI connection.`,
      400,
    );
  }

  if (normalized.length > maxLength) {
    throw new AIConnectionError(
      `${field}_too_long`,
      `${field} must be ${maxLength} characters or fewer.`,
      400,
    );
  }

  return normalized;
}

function normalizeOptionalText(value: string | undefined, field: string, maxLength: number): string | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  if (normalized.length > maxLength) {
    throw new AIConnectionError(
      `${field}_too_long`,
      `${field} must be ${maxLength} characters or fewer.`,
      400,
    );
  }

  return normalized;
}

function normalizeAllowedModels(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const normalizedValues: string[] = [];

  for (const entry of values) {
    const normalized = normalizeRequiredText(entry, "allowedModels", 160);
    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    normalizedValues.push(normalized);
  }

  return normalizedValues;
}

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

function normalizeProviderBaseUrl(provider: string, value: string | undefined): string | undefined {
  const normalized = normalizeOptionalText(value, "baseUrl", 500);
  if (!normalized) {
    if (PROVIDERS_REQUIRING_BASE_URL.has(provider)) {
      throw new AIConnectionError(
        "ai_connection_base_url_required",
        `${provider} connections require a base URL.`,
        400,
      );
    }

    return undefined;
  }

  if (!PROVIDERS_REQUIRING_BASE_URL.has(provider)) {
    throw new AIConnectionError(
      "ai_connection_base_url_not_supported",
      `${provider} connections do not accept a custom base URL. Use the openai-compatible provider for custom endpoints.`,
      400,
    );
  }

  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new AIConnectionError(
      "ai_connection_base_url_invalid",
      "baseUrl must be a valid absolute URL.",
      400,
    );
  }

  if (url.username || url.password) {
    throw new AIConnectionError(
      "ai_connection_base_url_credentials_forbidden",
      "baseUrl must not embed credentials.",
      400,
    );
  }

  const isLoopback = isLoopbackHostname(url.hostname);
  const isDevelopmentLoopback = process.env.NODE_ENV !== "production" && isLoopback && url.protocol === "http:";
  if (url.protocol !== "https:" && !isDevelopmentLoopback) {
    throw new AIConnectionError(
      "ai_connection_base_url_https_required",
      "baseUrl must use https unless you are connecting to a local development endpoint.",
      400,
    );
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  url.pathname = pathname || "/";

  return url.toString().replace(/\/$/, "");
}

function buildSecretStoreLabel(secretRef: string): string {
  const friendlyRef = secretRef.replace(/^ai-connection:/, "ai/");
  const compactRef = friendlyRef.length > 28
    ? `${friendlyRef.slice(0, 28)}…`
    : friendlyRef;

  return `Savant encrypted vault · ${compactRef}`;
}

function buildAIConnectionStatus(status: string, lastRotatedAt: Date | string | null, now: Date): AIConnectionSummary["status"] {
  if (status === "revoked") {
    return "revoked";
  }

  if (!lastRotatedAt) {
    return "needs-rotation";
  }

  const rotatedAt = new Date(lastRotatedAt);
  if (Number.isNaN(rotatedAt.valueOf())) {
    return "needs-rotation";
  }

  const ageMs = Math.max(now.getTime() - rotatedAt.getTime(), 0);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  return ageDays >= ROTATION_WARNING_DAYS ? "needs-rotation" : "active";
}

function formatRelativeTimeOrFallback(value: Date | string | null, fallback: string, now: Date): string {
  return value ? formatRelativeControlPlaneTime(value, now) : fallback;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function loadControlPlaneDatabaseIfConfigured() {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");
  return isControlPlaneDatabaseConfigured ? getControlPlaneDatabase() : null;
}

async function requireControlPlaneDatabase() {
  const sql = await loadControlPlaneDatabaseIfConfigured();
  if (!sql) {
    throw new AIConnectionError(
      "ai_connection_persistence_unconfigured",
      "DATABASE_URL must be configured before BYO-AI connections can be persisted.",
      503,
    );
  }

  return sql;
}

function normalizeProvider(provider: string): AIProviderId {
  const normalized = provider.trim().toLowerCase();
  if (!isSupportedAIProvider(normalized)) {
    throw new AIConnectionError(
      "ai_connection_provider_unsupported",
      `Unsupported AI provider: ${provider}.`,
      400,
    );
  }

  return normalized;
}

export function normalizeAIConnectionCreateRequest(
  request: AIConnectionCreateRequest,
): NormalizedAIConnectionCreateRequest {
  const provider = normalizeProvider(request.provider);
  const label = normalizeRequiredText(request.label, "label", 120);
  const defaultModel = normalizeRequiredText(request.defaultModel, "defaultModel", 160);
  const purpose = normalizeRequiredText(request.purpose, "purpose", 240);
  const usageScope = normalizeRequiredText(request.usageScope, "usageScope", 240);
  const apiKey = normalizeRequiredText(request.apiKey, "apiKey", 400);
  if (apiKey.length < 10) {
    throw new AIConnectionError(
      "ai_connection_api_key_invalid",
      "apiKey must be at least 10 characters long.",
      400,
    );
  }

  const supportsExecution = request.supportsExecution ?? true;
  const supportsJudging = request.supportsJudging ?? true;
  if (!supportsExecution && !supportsJudging) {
    throw new AIConnectionError(
      "ai_connection_capabilities_invalid",
      "An AI connection must support execution, judging, or both.",
      400,
    );
  }

  const isDefaultExecution = request.isDefaultExecution ?? false;
  const isDefaultJudge = request.isDefaultJudge ?? false;

  if (isDefaultExecution && !supportsExecution) {
    throw new AIConnectionError(
      "ai_connection_default_execution_invalid",
      "Execution defaults require supportsExecution to be enabled.",
      400,
    );
  }

  if (isDefaultJudge && !supportsJudging) {
    throw new AIConnectionError(
      "ai_connection_default_judge_invalid",
      "Judge defaults require supportsJudging to be enabled.",
      400,
    );
  }

  return {
    provider,
    label,
    defaultModel,
    purpose,
    usageScope,
    apiKey,
    allowedModels: normalizeAllowedModels(request.allowedModels),
    supportsExecution,
    supportsJudging,
    isDefaultExecution,
    isDefaultJudge,
    baseUrl: normalizeProviderBaseUrl(provider, request.baseUrl),
    apiVersion: normalizeOptionalText(request.apiVersion, "apiVersion", 80),
  };
}

export function normalizeAIConnectionRotateRequest(
  request: AIConnectionRotateRequest,
  provider: AIProviderId,
): NormalizedAIConnectionRotateRequest {
  const apiKey = normalizeRequiredText(request.apiKey, "apiKey", 400);
  if (apiKey.length < 10) {
    throw new AIConnectionError(
      "ai_connection_api_key_invalid",
      "apiKey must be at least 10 characters long.",
      400,
    );
  }

  return {
    apiKey,
    defaultModel: normalizeOptionalText(request.defaultModel, "defaultModel", 160),
    purpose: normalizeOptionalText(request.purpose, "purpose", 240),
    usageScope: normalizeOptionalText(request.usageScope, "usageScope", 240),
    allowedModels: request.allowedModels ? normalizeAllowedModels(request.allowedModels) : undefined,
    baseUrl: request.baseUrl === undefined ? undefined : normalizeProviderBaseUrl(provider, request.baseUrl),
    apiVersion: normalizeOptionalText(request.apiVersion, "apiVersion", 80),
  };
}

export function buildAIConnectionSummaryFromRecord(
  row: AIConnectionRow,
  now = new Date(),
): AIConnectionSummary {
  return {
    aiConnectionUuid: row.id,
    provider: row.providerType,
    label: row.displayName,
    defaultModel: row.defaultModel,
    purpose: row.purpose,
    status: buildAIConnectionStatus(row.status, row.lastRotatedAt, now),
    lastUsed: formatRelativeTimeOrFallback(row.lastUsedAt, "never", now),
    lastRotated: formatRelativeTimeOrFallback(row.lastRotatedAt, "unknown", now),
    secretStore: buildSecretStoreLabel(row.secretRef),
    usageScope: row.usageScope,
    supportsExecution: row.supportsExecution,
    supportsJudging: row.supportsJudging,
    isDefaultExecution: row.isDefaultExecution,
    isDefaultJudge: row.isDefaultJudge,
  };
}

export async function listAIConnectionSummariesForOrganization(
  organizationId: string,
  now = new Date(),
): Promise<AIConnectionSummary[]> {
  const sql = await loadControlPlaneDatabaseIfConfigured();
  if (!sql) {
    return [];
  }

  try {
    const rows = await sql<AIConnectionRow[]>`
      select
        id,
        provider_type as "providerType",
        display_name as "displayName",
        default_model as "defaultModel",
        purpose,
        usage_scope as "usageScope",
        supports_execution as "supportsExecution",
        supports_judging as "supportsJudging",
        is_default_execution as "isDefaultExecution",
        is_default_judge as "isDefaultJudge",
        status,
        secret_ref as "secretRef",
        last_used_at as "lastUsedAt",
        last_rotated_at as "lastRotatedAt",
        config
      from ai_connections
      where organization_id = ${organizationId}
      order by
        case when status = 'revoked' then 1 else 0 end asc,
        is_default_execution desc,
        is_default_judge desc,
        lower(display_name) asc
    `;

    return rows.map((row) => buildAIConnectionSummaryFromRecord(row, now));
  } catch (error) {
    if (isDatabaseErrorCode(error, "42P01")) {
      return [];
    }

    throw error;
  }
}

function assertAuthenticatedTenantContext(
  context: ResolvedTenantContext,
): asserts context is ResolvedTenantContext & {
  identity: NonNullable<ResolvedTenantContext["identity"]>;
} {
  if (!context.identity) {
    throw new AIConnectionError(
      "auth_required",
      "Sign in before managing BYO-AI connections.",
      401,
    );
  }
}

function buildAIConnectionConfig(input: NormalizedAIConnectionCreateRequest): AIConnectionConfig {
  const config: AIConnectionConfig = {};

  if (input.baseUrl) {
    config.baseUrl = input.baseUrl;
  }

  if (input.apiVersion) {
    config.apiVersion = input.apiVersion;
  }

  return config;
}

function buildUpdatedAIConnectionConfig(
  existingConfig: AIConnectionConfig | null,
  input: NormalizedAIConnectionRotateRequest,
): AIConnectionConfig {
  const config: AIConnectionConfig = {
    ...(existingConfig?.baseUrl ? { baseUrl: existingConfig.baseUrl } : {}),
    ...(existingConfig?.apiVersion ? { apiVersion: existingConfig.apiVersion } : {}),
  };

  if (input.baseUrl !== undefined) {
    if (input.baseUrl) {
      config.baseUrl = input.baseUrl;
    } else {
      delete config.baseUrl;
    }
  }

  if (input.apiVersion !== undefined) {
    if (input.apiVersion) {
      config.apiVersion = input.apiVersion;
    } else {
      delete config.apiVersion;
    }
  }

  return config;
}

async function loadAIConnectionRowForTenant(
  tx: TransactionSql,
  organizationId: string,
  aiConnectionId: string,
): Promise<AIConnectionRow> {
  const rows = await tx<AIConnectionRow[]>`
    select
      id,
      provider_type as "providerType",
      display_name as "displayName",
      default_model as "defaultModel",
      purpose,
      usage_scope as "usageScope",
      supports_execution as "supportsExecution",
      supports_judging as "supportsJudging",
      is_default_execution as "isDefaultExecution",
      is_default_judge as "isDefaultJudge",
      status,
      secret_ref as "secretRef",
      last_used_at as "lastUsedAt",
      last_rotated_at as "lastRotatedAt",
      config
    from ai_connections
    where id = ${aiConnectionId}
      and organization_id = ${organizationId}
    limit 1
  `;

  const connection = rows[0];
  if (!connection) {
    throw new AIConnectionError(
      "ai_connection_not_found",
      "That AI connection was not found in the current workspace.",
      404,
    );
  }

  return connection;
}

function assertActiveAIConnection(connection: AIConnectionRow) {
  if (connection.status === "revoked") {
    throw new AIConnectionError(
      "ai_connection_revoked",
      "Revoked AI connections cannot be modified. Create a new connection instead.",
      409,
    );
  }
}

function normalizeAIConnectionDefaultRequest(
  request: AIConnectionSetDefaultRequest,
): { setAsExecutionDefault: boolean; setAsJudgeDefault: boolean } {
  const setAsExecutionDefault = request.setAsExecutionDefault ?? false;
  const setAsJudgeDefault = request.setAsJudgeDefault ?? false;

  if (!setAsExecutionDefault && !setAsJudgeDefault) {
    throw new AIConnectionError(
      "ai_connection_default_flags_required",
      "At least one default flag must be set when updating AI connection defaults.",
      400,
    );
  }

  return {
    setAsExecutionDefault,
    setAsJudgeDefault,
  };
}

export async function createAIConnectionForTenant(
  input: {
    context: ResolvedTenantContext;
    request: AIConnectionCreateRequest;
    now?: Date | undefined;
  },
): Promise<AIConnectionSummary> {
  assertAuthenticatedTenantContext(input.context);
  const identity = input.context.identity;

  const normalized = normalizeAIConnectionCreateRequest(input.request);
  const aiConnectionId = randomUUID();
  const secretRef = `ai-connection:${aiConnectionId}`;
  const encryptedSecret = encryptAIConnectionSecret(normalized.apiKey, {
    organizationId: input.context.tenant.organizationId,
    aiConnectionId,
    provider: normalized.provider,
  });
  const connectionConfig = buildAIConnectionConfig(normalized);
  const sql = await requireControlPlaneDatabase();

  try {
    return await sql.begin(async (tx) => {
      const actor = await requireTenantAdminActor(
        tx,
        input.context,
      );
      const actorUserId = actor.userId;

      const existingDefaultRows = await tx<{
        hasExecutionDefault: boolean;
        hasJudgeDefault: boolean;
      }[]>`
        select
          exists(
            select 1
            from ai_connections
            where organization_id = ${input.context.tenant.organizationId}
              and status = 'active'
              and is_default_execution = true
          ) as "hasExecutionDefault",
          exists(
            select 1
            from ai_connections
            where organization_id = ${input.context.tenant.organizationId}
              and status = 'active'
              and is_default_judge = true
          ) as "hasJudgeDefault"
      `;

      const existingDefaults = existingDefaultRows[0] ?? {
        hasExecutionDefault: false,
        hasJudgeDefault: false,
      };

      const shouldDefaultExecution = normalized.supportsExecution
        && (normalized.isDefaultExecution || !existingDefaults.hasExecutionDefault);
      const shouldDefaultJudge = normalized.supportsJudging
        && (normalized.isDefaultJudge || !existingDefaults.hasJudgeDefault);

      if (shouldDefaultExecution) {
        await tx`
          update ai_connections
          set is_default_execution = false, updated_at = now()
          where organization_id = ${input.context.tenant.organizationId}
        `;
      }

      if (shouldDefaultJudge) {
        await tx`
          update ai_connections
          set is_default_judge = false, updated_at = now()
          where organization_id = ${input.context.tenant.organizationId}
        `;
      }

      const connectionRows = await tx<AIConnectionRow[]>`
        insert into ai_connections (
          id,
          organization_id,
          provider_type,
          display_name,
          default_model,
          purpose,
          usage_scope,
          allowed_models,
          supports_execution,
          supports_judging,
          is_default_execution,
          is_default_judge,
          status,
          secret_ref,
          config,
          created_by,
          last_rotated_at
        )
        values (
          ${aiConnectionId},
          ${input.context.tenant.organizationId},
          ${normalized.provider},
          ${normalized.label},
          ${normalized.defaultModel},
          ${normalized.purpose},
          ${normalized.usageScope},
          ${tx.json(normalized.allowedModels)},
          ${normalized.supportsExecution},
          ${normalized.supportsJudging},
          ${shouldDefaultExecution},
          ${shouldDefaultJudge},
          'active',
          ${secretRef},
          ${tx.json(connectionConfig)},
          ${actorUserId},
          now()
        )
        returning
          id,
          provider_type as "providerType",
          display_name as "displayName",
          default_model as "defaultModel",
          purpose,
          usage_scope as "usageScope",
          supports_execution as "supportsExecution",
          supports_judging as "supportsJudging",
          is_default_execution as "isDefaultExecution",
          is_default_judge as "isDefaultJudge",
          status,
          secret_ref as "secretRef",
          last_used_at as "lastUsedAt",
          last_rotated_at as "lastRotatedAt",
          config
      `;

      const connection = connectionRows[0];
      if (!connection) {
        throw new AIConnectionError(
          "ai_connection_create_failed",
          "The AI connection could not be persisted in the control plane.",
          500,
        );
      }

      await tx`
        insert into ai_connection_secrets (
          ai_connection_id,
          encrypted_secret,
          secret_fingerprint,
          algorithm,
          key_version
        )
        values (
          ${aiConnectionId},
          ${encryptedSecret.encryptedSecret},
          ${encryptedSecret.secretFingerprint},
          ${encryptedSecret.algorithm},
          ${encryptedSecret.keyVersion}
        )
      `;

      await tx`
        insert into audit_events (
          organization_id,
          actor_type,
          actor_ref,
          category,
          action,
          target_type,
          target_ref,
          payload_redacted
        )
        values (
          ${input.context.tenant.organizationId},
          'user',
          ${identity.subject},
          'evaluation',
          'ai_connection_created',
          'ai_connection',
          ${aiConnectionId},
          ${tx.json({
            provider: normalized.provider,
            label: normalized.label,
            defaultModel: normalized.defaultModel,
            usageScope: normalized.usageScope,
            supportsExecution: normalized.supportsExecution,
            supportsJudging: normalized.supportsJudging,
            isDefaultExecution: shouldDefaultExecution,
            isDefaultJudge: shouldDefaultJudge,
            allowedModelCount: normalized.allowedModels.length,
            baseUrlConfigured: Boolean(normalized.baseUrl),
          })}
        )
      `;

      return buildAIConnectionSummaryFromRecord(connection, input.now ?? new Date());
    });
  } catch (error) {
    if (error instanceof AIConnectionError || error instanceof AIConnectionSecretStoreError) {
      throw error;
    }

    if (isDatabaseErrorCode(error, "42P01")) {
      throw new AIConnectionError(
        "ai_connection_schema_missing",
        "The AI connection schema has not been applied to the control-plane database yet.",
        503,
      );
    }

    if (isDatabaseErrorCode(error, "23505")) {
      throw new AIConnectionError(
        "ai_connection_conflict",
        "An AI connection with that provider and label already exists in this workspace, or a default flag is already reserved by a concurrent request.",
        409,
      );
    }

    throw error;
  }
}

export async function revokeAIConnectionForTenant(
  input: {
    context: ResolvedTenantContext;
    aiConnectionId: string;
    reason?: string | undefined;
    now?: Date | undefined;
  },
): Promise<AIConnectionSummary> {
  assertAuthenticatedTenantContext(input.context);
  const identity = input.context.identity;

  if (!isUuid(input.aiConnectionId)) {
    throw new AIConnectionError(
      "ai_connection_id_invalid",
      "aiConnectionId must be a valid UUID.",
      400,
    );
  }

  const reason = normalizeOptionalText(input.reason, "reason", 240);
  const sql = await requireControlPlaneDatabase();

  try {
    return await sql.begin(async (tx) => {
      await requireTenantAdminActor(
        tx,
        input.context,
      );

      const revokedRows = await tx<AIConnectionRow[]>`
        update ai_connections
        set
          status = 'revoked',
          revoked_at = coalesce(revoked_at, now()),
          revoked_reason = coalesce(${reason ?? null}, revoked_reason),
          is_default_execution = false,
          is_default_judge = false,
          updated_at = now()
        where id = ${input.aiConnectionId}
          and organization_id = ${input.context.tenant.organizationId}
        returning
          id,
          provider_type as "providerType",
          display_name as "displayName",
          default_model as "defaultModel",
          purpose,
          usage_scope as "usageScope",
          supports_execution as "supportsExecution",
          supports_judging as "supportsJudging",
          is_default_execution as "isDefaultExecution",
          is_default_judge as "isDefaultJudge",
          status,
          secret_ref as "secretRef",
          last_used_at as "lastUsedAt",
          last_rotated_at as "lastRotatedAt",
          config
      `;

      const connection = revokedRows[0];
      if (!connection) {
        throw new AIConnectionError(
          "ai_connection_not_found",
          "That AI connection was not found in the current workspace.",
          404,
        );
      }

      await tx`
        insert into audit_events (
          organization_id,
          actor_type,
          actor_ref,
          category,
          action,
          target_type,
          target_ref,
          payload_redacted
        )
        values (
          ${input.context.tenant.organizationId},
          'user',
          ${identity.subject},
          'evaluation',
          'ai_connection_revoked',
          'ai_connection',
          ${input.aiConnectionId},
          ${tx.json({
            reason: reason ?? null,
          })}
        )
      `;

      return buildAIConnectionSummaryFromRecord(connection, input.now ?? new Date());
    });
  } catch (error) {
    if (error instanceof AIConnectionError) {
      throw error;
    }

    if (isDatabaseErrorCode(error, "42P01")) {
      throw new AIConnectionError(
        "ai_connection_schema_missing",
        "The AI connection schema has not been applied to the control-plane database yet.",
        503,
      );
    }

    throw error;
  }
}

export async function rotateAIConnectionForTenant(
  input: {
    context: ResolvedTenantContext;
    aiConnectionId: string;
    request: AIConnectionRotateRequest;
    now?: Date | undefined;
  },
): Promise<AIConnectionSummary> {
  assertAuthenticatedTenantContext(input.context);
  const identity = input.context.identity;

  if (!isUuid(input.aiConnectionId)) {
    throw new AIConnectionError(
      "ai_connection_id_invalid",
      "aiConnectionId must be a valid UUID.",
      400,
    );
  }

  const sql = await requireControlPlaneDatabase();

  try {
    return await sql.begin(async (tx) => {
      await requireTenantAdminActor(tx, input.context);
      const existingConnection = await loadAIConnectionRowForTenant(
        tx,
        input.context.tenant.organizationId,
        input.aiConnectionId,
      );
      assertActiveAIConnection(existingConnection);

      const normalized = normalizeAIConnectionRotateRequest(
        input.request,
        existingConnection.providerType,
      );
      const encryptedSecret = encryptAIConnectionSecret(normalized.apiKey, {
        organizationId: input.context.tenant.organizationId,
        aiConnectionId: input.aiConnectionId,
        provider: existingConnection.providerType,
      });

      const updatedConfig = buildUpdatedAIConnectionConfig(existingConnection.config, normalized);
      const updatedRows = await tx<AIConnectionRow[]>`
        update ai_connections
        set
          default_model = coalesce(${normalized.defaultModel ?? null}, default_model),
          purpose = coalesce(${normalized.purpose ?? null}, purpose),
          usage_scope = coalesce(${normalized.usageScope ?? null}, usage_scope),
          allowed_models = coalesce(${normalized.allowedModels ? tx.json(normalized.allowedModels) : null}, allowed_models),
          config = ${tx.json(updatedConfig)},
          last_rotated_at = now(),
          updated_at = now()
        where id = ${input.aiConnectionId}
          and organization_id = ${input.context.tenant.organizationId}
        returning
          id,
          provider_type as "providerType",
          display_name as "displayName",
          default_model as "defaultModel",
          purpose,
          usage_scope as "usageScope",
          supports_execution as "supportsExecution",
          supports_judging as "supportsJudging",
          is_default_execution as "isDefaultExecution",
          is_default_judge as "isDefaultJudge",
          status,
          secret_ref as "secretRef",
          last_used_at as "lastUsedAt",
          last_rotated_at as "lastRotatedAt",
          config
      `;

      const connection = updatedRows[0];
      if (!connection) {
        throw new AIConnectionError(
          "ai_connection_rotate_failed",
          "The AI connection could not be rotated in the control plane.",
          500,
        );
      }

      await tx`
        update ai_connection_secrets
        set
          encrypted_secret = ${encryptedSecret.encryptedSecret},
          secret_fingerprint = ${encryptedSecret.secretFingerprint},
          algorithm = ${encryptedSecret.algorithm},
          key_version = ${encryptedSecret.keyVersion},
          updated_at = now()
        where ai_connection_id = ${input.aiConnectionId}
      `;

      await tx`
        insert into audit_events (
          organization_id,
          actor_type,
          actor_ref,
          category,
          action,
          target_type,
          target_ref,
          payload_redacted
        )
        values (
          ${input.context.tenant.organizationId},
          'user',
          ${identity.subject},
          'evaluation',
          'ai_connection_rotated',
          'ai_connection',
          ${input.aiConnectionId},
          ${tx.json({
            defaultModelUpdated: normalized.defaultModel !== undefined,
            purposeUpdated: normalized.purpose !== undefined,
            usageScopeUpdated: normalized.usageScope !== undefined,
            allowedModelsUpdated: normalized.allowedModels !== undefined,
            baseUrlUpdated: normalized.baseUrl !== undefined,
            apiVersionUpdated: normalized.apiVersion !== undefined,
          })}
        )
      `;

      return buildAIConnectionSummaryFromRecord(connection, input.now ?? new Date());
    });
  } catch (error) {
    if (error instanceof AIConnectionError || error instanceof AIConnectionSecretStoreError) {
      throw error;
    }

    if (isDatabaseErrorCode(error, "42P01")) {
      throw new AIConnectionError(
        "ai_connection_schema_missing",
        "The AI connection schema has not been applied to the control-plane database yet.",
        503,
      );
    }

    throw error;
  }
}

export async function setAIConnectionDefaultsForTenant(
  input: {
    context: ResolvedTenantContext;
    aiConnectionId: string;
    request: AIConnectionSetDefaultRequest;
    now?: Date | undefined;
  },
): Promise<AIConnectionSummary> {
  assertAuthenticatedTenantContext(input.context);
  const identity = input.context.identity;

  if (!isUuid(input.aiConnectionId)) {
    throw new AIConnectionError(
      "ai_connection_id_invalid",
      "aiConnectionId must be a valid UUID.",
      400,
    );
  }

  const defaults = normalizeAIConnectionDefaultRequest(input.request);
  const sql = await requireControlPlaneDatabase();

  try {
    return await sql.begin(async (tx) => {
      await requireTenantAdminActor(tx, input.context);
      const existingConnection = await loadAIConnectionRowForTenant(
        tx,
        input.context.tenant.organizationId,
        input.aiConnectionId,
      );
      assertActiveAIConnection(existingConnection);

      if (defaults.setAsExecutionDefault && !existingConnection.supportsExecution) {
        throw new AIConnectionError(
          "ai_connection_default_execution_invalid",
          "Execution defaults require a connection that supports execution.",
          400,
        );
      }

      if (defaults.setAsJudgeDefault && !existingConnection.supportsJudging) {
        throw new AIConnectionError(
          "ai_connection_default_judge_invalid",
          "Judge defaults require a connection that supports judging.",
          400,
        );
      }

      if (defaults.setAsExecutionDefault) {
        await tx`
          update ai_connections
          set is_default_execution = false, updated_at = now()
          where organization_id = ${input.context.tenant.organizationId}
            and id <> ${input.aiConnectionId}
        `;
      }

      if (defaults.setAsJudgeDefault) {
        await tx`
          update ai_connections
          set is_default_judge = false, updated_at = now()
          where organization_id = ${input.context.tenant.organizationId}
            and id <> ${input.aiConnectionId}
        `;
      }

      const updatedRows = await tx<AIConnectionRow[]>`
        update ai_connections
        set
          is_default_execution = case
            when ${defaults.setAsExecutionDefault} then true
            else is_default_execution
          end,
          is_default_judge = case
            when ${defaults.setAsJudgeDefault} then true
            else is_default_judge
          end,
          updated_at = now()
        where id = ${input.aiConnectionId}
          and organization_id = ${input.context.tenant.organizationId}
        returning
          id,
          provider_type as "providerType",
          display_name as "displayName",
          default_model as "defaultModel",
          purpose,
          usage_scope as "usageScope",
          supports_execution as "supportsExecution",
          supports_judging as "supportsJudging",
          is_default_execution as "isDefaultExecution",
          is_default_judge as "isDefaultJudge",
          status,
          secret_ref as "secretRef",
          last_used_at as "lastUsedAt",
          last_rotated_at as "lastRotatedAt",
          config
      `;

      const connection = updatedRows[0];
      if (!connection) {
        throw new AIConnectionError(
          "ai_connection_not_found",
          "That AI connection was not found in the current workspace.",
          404,
        );
      }

      await tx`
        insert into audit_events (
          organization_id,
          actor_type,
          actor_ref,
          category,
          action,
          target_type,
          target_ref,
          payload_redacted
        )
        values (
          ${input.context.tenant.organizationId},
          'user',
          ${identity.subject},
          'evaluation',
          'ai_connection_default_updated',
          'ai_connection',
          ${input.aiConnectionId},
          ${tx.json(defaults)}
        )
      `;

      return buildAIConnectionSummaryFromRecord(connection, input.now ?? new Date());
    });
  } catch (error) {
    if (error instanceof AIConnectionError) {
      throw error;
    }

    if (isDatabaseErrorCode(error, "42P01")) {
      throw new AIConnectionError(
        "ai_connection_schema_missing",
        "The AI connection schema has not been applied to the control-plane database yet.",
        503,
      );
    }

    if (isDatabaseErrorCode(error, "23505")) {
      throw new AIConnectionError(
        "ai_connection_conflict",
        "A concurrent request reserved the requested default flag. Retry the default update.",
        409,
      );
    }

    throw error;
  }
}
