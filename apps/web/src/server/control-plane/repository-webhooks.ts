import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { GitProvider } from "@savant/types";

import { isLocalDevHostname, resolveAuth0AppBaseUrl, type Auth0Env } from "../../lib/auth0-config.ts";

import { createProviderAuthenticatedFetch } from "./repository-provider-authenticated-fetch.ts";
import {
  resolveRepositoryProviderAccessToken,
  resolveRepositoryProviderConnection,
  resolveRepositoryProviderSecretFromRef,
  RepositoryProviderConnectionError,
} from "./repository-provider-connection.ts";
import {
  type RepositoryIndexActor,
  indexRepositoryById,
  RepositoryIndexError,
} from "./repository-index.ts";
import type { ParsedRepositoryLocator } from "./repository-provider.ts";
import { RepositoryProviderError } from "./repository-provider-read.ts";
import { resolveRepositoryWriteAdapter } from "./repository-provider-write-adapter.ts";

export const REPOSITORY_WEBHOOK_ENV_VAR_NAME = "REPOSITORY_WEBHOOK_SECRET";
const REPOSITORY_WEBHOOK_SYSTEM_ACTOR = "repository-webhook";
const REPOSITORY_WEBHOOK_EVENTS = ["push"] as const;

export class RepositoryWebhookError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string | undefined;

  constructor(code: string, message: string, status = 400, details?: string) {
    super(message);
    this.name = "RepositoryWebhookError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

type RepositoryWebhookRegistrationRow = {
  id: string;
  repositoryId: string;
  endpointPath: string;
  secretRef: string;
  providerWebhookId: string | null;
  status: "active" | "warning" | "disabled";
};

type RepositoryWebhookTarget = RepositoryWebhookRegistrationRow & {
  organizationId: string;
  providerType: GitProvider;
  ownerName: string;
  repoName: string;
  defaultBranch: string;
  externalRepoId: string | null;
  connectionId: string | null;
  canonicalCloneUrl: string | null;
  lastIndexedCommitSha: string | null;
};

type RepositoryWebhookDeliveryDecision = {
  indexed: boolean;
  message: string;
  commitSha: string | null;
  branch: string | null;
};

type RepositoryWebhookRegistrationOutcome = {
  registered: boolean;
  callbackUrl: string;
  endpointPath: string;
  warning?: string | undefined;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type GitHubWebhookRepositoryPayload = {
  id?: number;
  full_name?: string;
};

type GitHubWebhookPayload = {
  ref?: string;
  after?: string;
  deleted?: boolean;
  repository?: GitHubWebhookRepositoryPayload;
};

type GitLabWebhookProjectPayload = {
  id?: number;
  path_with_namespace?: string;
};

type GitLabWebhookPayload = {
  ref?: string;
  after?: string;
  project_id?: number;
  project?: GitLabWebhookProjectPayload;
};

function isAllZeroGitRevision(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return /^0+$/i.test(value.trim());
}

function toLowerCase(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized.toLowerCase() : null;
}

function extractBranchName(ref: string | undefined): string | null {
  const normalized = ref?.trim();

  if (!normalized) {
    return null;
  }

  return normalized.replace(/^refs\/heads\//i, "");
}

function buffersEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function normalizeKnownWebhookError(error: unknown): RepositoryWebhookError {
  if (error instanceof RepositoryWebhookError) {
    return error;
  }

  if (error instanceof RepositoryProviderConnectionError) {
    return new RepositoryWebhookError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof RepositoryProviderError) {
    return new RepositoryWebhookError(error.code, error.message, error.status, error.details);
  }

  if (error instanceof RepositoryIndexError) {
    return new RepositoryWebhookError(error.code, error.message, error.status, error.details);
  }

  return new RepositoryWebhookError(
    "repository_webhook_failed",
    "Repository webhook processing failed unexpectedly.",
    500,
  );
}

function buildWebhookSystemActor(webhookId: string): RepositoryIndexActor {
  return {
    type: "system",
    ref: `${REPOSITORY_WEBHOOK_SYSTEM_ACTOR}:${webhookId}`,
  };
}

function buildRegistrationWarning(message: string): string {
  return `Webhook sync was requested, but repository webhook registration did not complete: ${message}`;
}

function buildRepositoryFullName(target: Pick<RepositoryWebhookTarget, "ownerName" | "repoName">): string {
  return `${target.ownerName}/${target.repoName}`;
}

async function loadRepositoryWebhookTarget(
  webhookId: string,
): Promise<RepositoryWebhookTarget | null> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new RepositoryWebhookError(
      "repository_webhook_unconfigured",
      "DATABASE_URL must be configured before repository webhooks can be processed.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();
  const rows = await sql<RepositoryWebhookTarget[]>`
    select
      repository_webhooks.id,
      repository_webhooks.repository_id as "repositoryId",
      repository_webhooks.endpoint_path as "endpointPath",
      repository_webhooks.secret_ref as "secretRef",
      repository_webhooks.provider_webhook_id as "providerWebhookId",
      repository_webhooks.status,
      repositories.organization_id as "organizationId",
      repositories.provider_type as "providerType",
      repositories.owner_name as "ownerName",
      repositories.repo_name as "repoName",
      repositories.default_branch as "defaultBranch",
      repositories.external_repo_id as "externalRepoId",
      repositories.connection_id as "connectionId",
      repositories.canonical_clone_url as "canonicalCloneUrl",
      repository_sync_state.last_indexed_commit_sha as "lastIndexedCommitSha"
    from repository_webhooks
    inner join repositories on repositories.id = repository_webhooks.repository_id
    left join repository_sync_state on repository_sync_state.repository_id = repositories.id
    where repository_webhooks.id = ${webhookId}
    limit 1
  `;

  return rows[0] ?? null;
}

async function ensureRepositoryWebhookRow(
  repositoryId: string,
): Promise<RepositoryWebhookRegistrationRow> {
  const { getControlPlaneDatabase, isControlPlaneDatabaseConfigured } = await import("./database.ts");

  if (!isControlPlaneDatabaseConfigured) {
    throw new RepositoryWebhookError(
      "repository_webhook_unconfigured",
      "DATABASE_URL must be configured before repository webhooks can be registered.",
      503,
    );
  }

  const sql = getControlPlaneDatabase();
  const existingRows = await sql<RepositoryWebhookRegistrationRow[]>`
    select
      id,
      repository_id as "repositoryId",
      endpoint_path as "endpointPath",
      secret_ref as "secretRef",
      provider_webhook_id as "providerWebhookId",
      status
    from repository_webhooks
    where repository_id = ${repositoryId}
    order by created_at asc
    limit 1
  `;

  const existing = existingRows[0];
  if (existing) {
    return existing;
  }

  const webhookId = randomUUID();
  const endpointPath = buildRepositoryWebhookEndpointPath(webhookId);
  const insertedRows = await sql<RepositoryWebhookRegistrationRow[]>`
    insert into repository_webhooks (
      id,
      repository_id,
      endpoint_path,
      secret_ref,
      status
    )
    values (
      ${webhookId},
      ${repositoryId},
      ${endpointPath},
      ${REPOSITORY_WEBHOOK_ENV_VAR_NAME},
      'warning'
    )
    returning
      id,
      repository_id as "repositoryId",
      endpoint_path as "endpointPath",
      secret_ref as "secretRef",
      provider_webhook_id as "providerWebhookId",
      status
  `;

  const inserted = insertedRows[0];

  if (!inserted) {
    throw new RepositoryWebhookError(
      "repository_webhook_persist_failed",
      "Repository webhook registration could not be persisted in the control plane.",
      500,
    );
  }

  return inserted;
}

async function updateRepositoryWebhookConnection(
  repositoryId: string,
  connectionId: string,
): Promise<void> {
  const { getControlPlaneDatabase } = await import("./database.ts");
  const sql = getControlPlaneDatabase();

  await sql`
    update repositories
    set connection_id = ${connectionId}
    where id = ${repositoryId}
  `;
}

async function markRepositoryWebhookStatus(input: {
  webhookId: string;
  repositoryId: string;
  status: "active" | "warning" | "disabled";
  providerWebhookId?: string | null | undefined;
  deliveredAt?: Date | undefined;
  now: Date;
}): Promise<void> {
  const { getControlPlaneDatabase } = await import("./database.ts");
  const sql = getControlPlaneDatabase();

  await sql.begin(async (tx) => {
    await tx`
      update repository_webhooks
      set
        status = ${input.status},
        provider_webhook_id = coalesce(${input.providerWebhookId ?? null}, repository_webhooks.provider_webhook_id),
        last_delivery_at = coalesce(${input.deliveredAt ?? null}, repository_webhooks.last_delivery_at),
        updated_at = ${input.now}
      where id = ${input.webhookId}
    `;

    if (input.deliveredAt) {
      await tx`
        insert into repository_sync_state (
          repository_id,
          sync_mode,
          status,
          last_webhook_at,
          next_poll_at,
          error_code,
          error_message
        )
        values (
          ${input.repositoryId},
          'webhook',
          'idle',
          ${input.deliveredAt},
          null,
          null,
          null
        )
        on conflict (repository_id) do update
        set last_webhook_at = excluded.last_webhook_at
      `;
    }
  });
}

async function insertRepositoryWebhookAuditEvent(input: {
  organizationId: string;
  action: string;
  targetRef: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const { getControlPlaneDatabase } = await import("./database.ts");
  const sql = getControlPlaneDatabase();
  const payload = JSON.parse(JSON.stringify(input.payload)) as { [key: string]: JsonValue };

  await sql`
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
      ${input.organizationId},
      'system',
      ${REPOSITORY_WEBHOOK_SYSTEM_ACTOR},
      'repo',
      ${input.action},
      'repository',
      ${input.targetRef},
      ${sql.json(payload)}
    )
  `;
}

function assertRepositoryWebhookTarget(
  target: RepositoryWebhookTarget | null,
  webhookId: string,
): RepositoryWebhookTarget {
  if (!target) {
    throw new RepositoryWebhookError(
      "repository_webhook_not_found",
      `Repository webhook '${webhookId}' was not found.`,
      404,
    );
  }

  if (target.status === "disabled") {
    throw new RepositoryWebhookError(
      "repository_webhook_disabled",
      "Repository webhook delivery is disabled for this repository.",
      410,
    );
  }

  return target;
}

function parseWebhookJson<T>(rawBody: string, provider: GitProvider): T {
  try {
    return JSON.parse(rawBody) as T;
  } catch (error) {
    throw new RepositoryWebhookError(
      `${provider}_webhook_invalid_json`,
      `${provider} webhook payloads must be valid JSON.`,
      400,
      error instanceof Error ? error.message : undefined,
    );
  }
}

function assertGitHubRepositoryMatch(
  target: RepositoryWebhookTarget,
  payload: GitHubWebhookPayload,
): void {
  const payloadRepositoryId = payload.repository?.id;
  if (
    target.externalRepoId
    && typeof payloadRepositoryId === "number"
    && String(payloadRepositoryId) !== target.externalRepoId
  ) {
    throw new RepositoryWebhookError(
      "github_webhook_repository_mismatch",
      "GitHub webhook payload did not match the expected repository id.",
      403,
    );
  }

  const payloadFullName = toLowerCase(payload.repository?.full_name);
  const expectedFullName = toLowerCase(buildRepositoryFullName(target));

  if (!payloadFullName || payloadFullName !== expectedFullName) {
    throw new RepositoryWebhookError(
      "github_webhook_repository_mismatch",
      "GitHub webhook payload did not match the expected repository name.",
      403,
    );
  }
}

function assertGitLabRepositoryMatch(
  target: RepositoryWebhookTarget,
  payload: GitLabWebhookPayload,
): void {
  const payloadProjectId = payload.project_id ?? payload.project?.id;
  if (
    target.externalRepoId
    && typeof payloadProjectId === "number"
    && String(payloadProjectId) !== target.externalRepoId
  ) {
    throw new RepositoryWebhookError(
      "gitlab_webhook_repository_mismatch",
      "GitLab webhook payload did not match the expected project id.",
      403,
    );
  }

  const payloadPath = toLowerCase(payload.project?.path_with_namespace);
  const expectedPath = toLowerCase(buildRepositoryFullName(target));

  if (!payloadPath || payloadPath !== expectedPath) {
    throw new RepositoryWebhookError(
      "gitlab_webhook_repository_mismatch",
      "GitLab webhook payload did not match the expected project path.",
      403,
    );
  }
}

export function verifyGitHubWebhookSignature(input: {
  headers: Headers;
  rawBody: string;
  secret: string;
}): void {
  const providedSignature = input.headers.get("x-hub-signature-256")?.trim();

  if (!providedSignature) {
    throw new RepositoryWebhookError(
      "github_webhook_signature_missing",
      "Missing GitHub webhook signature header.",
      401,
    );
  }

  const expectedSignature = `sha256=${createHmac("sha256", input.secret).update(input.rawBody).digest("hex")}`;

  if (!buffersEqual(providedSignature, expectedSignature)) {
    throw new RepositoryWebhookError(
      "github_webhook_signature_invalid",
      "GitHub webhook signature verification failed.",
      401,
    );
  }
}

export function verifyGitLabWebhookToken(input: {
  headers: Headers;
  secret: string;
}): void {
  const providedToken = input.headers.get("x-gitlab-token")?.trim();

  if (!providedToken) {
    throw new RepositoryWebhookError(
      "gitlab_webhook_token_missing",
      "Missing GitLab webhook token header.",
      401,
    );
  }

  if (!buffersEqual(providedToken, input.secret)) {
    throw new RepositoryWebhookError(
      "gitlab_webhook_token_invalid",
      "GitLab webhook token verification failed.",
      401,
    );
  }
}

export function parseGitHubRepositoryWebhookEvent(input: {
  target: RepositoryWebhookTarget;
  headers: Headers;
  rawBody: string;
}): RepositoryWebhookDeliveryDecision {
  const eventName = input.headers.get("x-github-event")?.trim().toLowerCase();

  if (!eventName) {
    throw new RepositoryWebhookError(
      "github_webhook_event_missing",
      "Missing GitHub webhook event header.",
      400,
    );
  }

  const payload = parseWebhookJson<GitHubWebhookPayload>(input.rawBody, "github");
  assertGitHubRepositoryMatch(input.target, payload);

  if (eventName === "ping") {
    return {
      indexed: false,
      message: "GitHub webhook verified successfully.",
      commitSha: null,
      branch: null,
    };
  }

  if (eventName !== "push") {
    return {
      indexed: false,
      message: `GitHub event '${eventName}' does not trigger repository indexing.`,
      commitSha: null,
      branch: null,
    };
  }

  const branch = extractBranchName(payload.ref);
  if (!branch || branch !== input.target.defaultBranch) {
    return {
      indexed: false,
      message: `GitHub push events only trigger indexing for the default branch '${input.target.defaultBranch}'.`,
      commitSha: null,
      branch,
    };
  }

  const commitSha = payload.after?.trim() || null;
  if (!commitSha || payload.deleted || isAllZeroGitRevision(commitSha)) {
    return {
      indexed: false,
      message: "GitHub webhook delivery did not include an indexable branch update.",
      commitSha,
      branch,
    };
  }

  if (input.target.lastIndexedCommitSha?.trim() === commitSha) {
    return {
      indexed: false,
      message: `Commit '${commitSha.slice(0, 12)}' is already indexed.`,
      commitSha,
      branch,
    };
  }

  return {
    indexed: true,
    message: `GitHub push for '${branch}' accepted.`,
    commitSha,
    branch,
  };
}

export function parseGitLabRepositoryWebhookEvent(input: {
  target: RepositoryWebhookTarget;
  headers: Headers;
  rawBody: string;
}): RepositoryWebhookDeliveryDecision {
  const eventName = input.headers.get("x-gitlab-event")?.trim();

  if (!eventName) {
    throw new RepositoryWebhookError(
      "gitlab_webhook_event_missing",
      "Missing GitLab webhook event header.",
      400,
    );
  }

  const payload = parseWebhookJson<GitLabWebhookPayload>(input.rawBody, "gitlab");
  assertGitLabRepositoryMatch(input.target, payload);

  if (eventName !== "Push Hook") {
    return {
      indexed: false,
      message: `GitLab event '${eventName}' does not trigger repository indexing.`,
      commitSha: null,
      branch: null,
    };
  }

  const branch = extractBranchName(payload.ref);
  if (!branch || branch !== input.target.defaultBranch) {
    return {
      indexed: false,
      message: `GitLab push events only trigger indexing for the default branch '${input.target.defaultBranch}'.`,
      commitSha: null,
      branch,
    };
  }

  const commitSha = payload.after?.trim() || null;
  if (!commitSha || isAllZeroGitRevision(commitSha)) {
    return {
      indexed: false,
      message: "GitLab webhook delivery did not include an indexable branch update.",
      commitSha,
      branch,
    };
  }

  if (input.target.lastIndexedCommitSha?.trim() === commitSha) {
    return {
      indexed: false,
      message: `Commit '${commitSha.slice(0, 12)}' is already indexed.`,
      commitSha,
      branch,
    };
  }

  return {
    indexed: true,
    message: `GitLab push for '${branch}' accepted.`,
    commitSha,
    branch,
  };
}

export function resolveRepositoryWebhookPublicBaseUrl(env: Auth0Env = process.env): string {
  const appBaseUrl = resolveAuth0AppBaseUrl(env);

  if (!appBaseUrl) {
    throw new RepositoryWebhookError(
      "repository_webhook_public_origin_missing",
      "Configure APP_BASE_URL, NEXT_PUBLIC_APP_URL, or Vercel production metadata before Savant can register repository webhooks.",
      503,
    );
  }

  const resolvedOrigin = new URL(appBaseUrl).origin;

  if (isLocalDevHostname(new URL(resolvedOrigin).hostname)) {
    throw new RepositoryWebhookError(
      "repository_webhook_public_origin_invalid",
      "Repository webhooks require a non-local public origin. Point APP_BASE_URL or NEXT_PUBLIC_APP_URL at the deployed Savant origin before enabling webhook sync.",
      409,
    );
  }

  return resolvedOrigin;
}

export function buildRepositoryWebhookEndpointPath(webhookId: string): string {
  return `/api/repositories/webhooks/${encodeURIComponent(webhookId)}`;
}

function buildRepositoryWebhookCallbackUrl(webhookId: string, env: Auth0Env = process.env): string {
  return `${resolveRepositoryWebhookPublicBaseUrl(env)}${buildRepositoryWebhookEndpointPath(webhookId)}`;
}

export async function ensureRepositoryWebhookRegistration(input: {
  organizationId: string;
  repositoryId: string;
  provider: GitProvider;
  locator: ParsedRepositoryLocator;
  connectionId?: string | undefined;
  now?: Date | undefined;
}, options?: {
  env?: Auth0Env | undefined;
}): Promise<RepositoryWebhookRegistrationOutcome> {
  const now = input.now ?? new Date();
  const env = options?.env ?? process.env;
  const webhookRow = await ensureRepositoryWebhookRow(input.repositoryId);
  const callbackUrl = buildRepositoryWebhookCallbackUrl(webhookRow.id, env);

  if (webhookRow.providerWebhookId && webhookRow.status === "active") {
    return {
      registered: true,
      callbackUrl,
      endpointPath: webhookRow.endpointPath,
    };
  }

  try {
    const connection = await resolveRepositoryProviderConnection({
      organizationId: input.organizationId,
      provider: input.provider,
      connectionId: input.connectionId,
    });
    const accessToken = resolveRepositoryProviderAccessToken(connection, env);
    const fetcher = createProviderAuthenticatedFetch(input.provider, accessToken);
    const adapter = resolveRepositoryWriteAdapter(input.provider, {
      fetcher,
      env,
    });
    const registration = await adapter.registerWebhook(input.locator, {
      callbackUrl,
      secretRef: webhookRow.secretRef,
      events: [...REPOSITORY_WEBHOOK_EVENTS],
    });

    await updateRepositoryWebhookConnection(input.repositoryId, connection.id);
    await markRepositoryWebhookStatus({
      webhookId: webhookRow.id,
      repositoryId: input.repositoryId,
      status: "active",
      providerWebhookId: registration.id,
      now,
    });
    await insertRepositoryWebhookAuditEvent({
      organizationId: input.organizationId,
      action: "repository_webhook_registered",
      targetRef: input.repositoryId,
      payload: {
        provider: input.provider,
        endpointPath: webhookRow.endpointPath,
        providerWebhookId: registration.id,
        callbackUrl,
      },
    });

    return {
      registered: true,
      callbackUrl,
      endpointPath: webhookRow.endpointPath,
    };
  } catch (error) {
    const normalizedError = normalizeKnownWebhookError(error);

    await markRepositoryWebhookStatus({
      webhookId: webhookRow.id,
      repositoryId: input.repositoryId,
      status: "warning",
      now,
    });
    await insertRepositoryWebhookAuditEvent({
      organizationId: input.organizationId,
      action: "repository_webhook_registration_failed",
      targetRef: input.repositoryId,
      payload: {
        provider: input.provider,
        endpointPath: webhookRow.endpointPath,
        code: normalizedError.code,
        message: normalizedError.message,
      },
    });

    return {
      registered: false,
      callbackUrl,
      endpointPath: webhookRow.endpointPath,
      warning: buildRegistrationWarning(normalizedError.message),
    };
  }
}

export async function processRepositoryWebhookDelivery(input: {
  webhookId: string;
  headers: Headers;
  rawBody: string;
  now?: Date | undefined;
}, options?: {
  env?: Auth0Env | undefined;
}): Promise<{ received: true; indexed: boolean; message: string }> {
  const target = assertRepositoryWebhookTarget(
    await loadRepositoryWebhookTarget(input.webhookId),
    input.webhookId,
  );
  const now = input.now ?? new Date();
  const env = options?.env ?? process.env;
  const secret = resolveRepositoryProviderSecretFromRef(target.secretRef, env);

  let decision: RepositoryWebhookDeliveryDecision;

  switch (target.providerType) {
    case "github": {
      verifyGitHubWebhookSignature({
        headers: input.headers,
        rawBody: input.rawBody,
        secret,
      });
      decision = parseGitHubRepositoryWebhookEvent({
        target,
        headers: input.headers,
        rawBody: input.rawBody,
      });
      break;
    }
    case "gitlab": {
      verifyGitLabWebhookToken({
        headers: input.headers,
        secret,
      });
      decision = parseGitLabRepositoryWebhookEvent({
        target,
        headers: input.headers,
        rawBody: input.rawBody,
      });
      break;
    }
    default:
      throw new RepositoryWebhookError(
        "repository_webhook_provider_unsupported",
        `Repository webhook intake is not wired for provider '${target.providerType}' in the current MVP.`,
        409,
      );
  }

  await markRepositoryWebhookStatus({
    webhookId: target.id,
    repositoryId: target.repositoryId,
    status: "active",
    deliveredAt: now,
    now,
  });

  if (!decision.indexed) {
    await insertRepositoryWebhookAuditEvent({
      organizationId: target.organizationId,
      action: "repository_webhook_ignored",
      targetRef: target.repositoryId,
      payload: {
        provider: target.providerType,
        webhookId: target.id,
        branch: decision.branch,
        commitSha: decision.commitSha,
        message: decision.message,
      },
    });

    return {
      received: true,
      indexed: false,
      message: decision.message,
    };
  }

  try {
    const indexed = await indexRepositoryById({
      organizationId: target.organizationId,
      repositoryId: target.repositoryId,
      actor: buildWebhookSystemActor(target.id),
      requestedAt: now,
      now,
    });

    await insertRepositoryWebhookAuditEvent({
      organizationId: target.organizationId,
      action: "repository_webhook_received",
      targetRef: target.repositoryId,
      payload: {
        provider: target.providerType,
        webhookId: target.id,
        branch: decision.branch,
        commitSha: decision.commitSha,
        indexedSkillCount: indexed.indexedSkillCount,
        warnings: indexed.warnings,
      },
    });

    return {
      received: true,
      indexed: true,
      message: indexed.message,
    };
  } catch (error) {
    const normalizedError = normalizeKnownWebhookError(error);

    await markRepositoryWebhookStatus({
      webhookId: target.id,
      repositoryId: target.repositoryId,
      status: "warning",
      deliveredAt: now,
      now,
    });
    await insertRepositoryWebhookAuditEvent({
      organizationId: target.organizationId,
      action: "repository_webhook_processing_failed",
      targetRef: target.repositoryId,
      payload: {
        provider: target.providerType,
        webhookId: target.id,
        branch: decision.branch,
        commitSha: decision.commitSha,
        code: normalizedError.code,
        message: normalizedError.message,
      },
    });

    throw normalizedError;
  }
}
