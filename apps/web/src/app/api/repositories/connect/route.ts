import {
  connectTenantRepository,
  RepositoryConnectError,
} from "@/server/control-plane/repository-connect";
import { indexTenantRepository, RepositoryIndexError } from "@/server/control-plane/repository-index";
import { RepositoryProviderConnectionError } from "@/server/control-plane/repository-provider-connection";
import { RepositoryProviderError } from "@/server/control-plane/repository-provider-read";
import {
  RepositoryRequestError,
  resolveRepositoryConnectRequest,
} from "@/server/control-plane/repository-request";
import { validateTenantSkillRepoContract } from "@/server/control-plane/repository-scaffold";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";
import { TenantWriteAccessError } from "@/server/control-plane/tenant-write-access";
import { ensureRepositoryWebhookRegistration } from "@/server/control-plane/repository-webhooks";
import { readJsonObject } from "@/server/control-plane/request-validation";
import type { RouteHandledError } from "@/server/control-plane/write-route-handlers";
import { createRepositoryConnectPostHandler } from "@/server/control-plane/write-route-handlers";

function isKnownRepositoryConnectRouteError(error: unknown): error is RouteHandledError {
  return error instanceof RepositoryProviderError
    || error instanceof RepositoryRequestError
    || error instanceof RepositoryConnectError
    || error instanceof TenantWriteAccessError
    || error instanceof TenantContextError;
}

function isRepositoryIndexRouteError(error: unknown): error is RouteHandledError {
  return error instanceof RepositoryIndexError
    || error instanceof RepositoryProviderError
    || error instanceof RepositoryProviderConnectionError;
}

export const POST = createRepositoryConnectPostHandler({
  authorizeTenantRequest,
  readJsonObject,
  resolveRepositoryConnectRequest,
  validateTenantSkillRepoContract,
  connectTenantRepository,
  ensureRepositoryWebhookRegistration,
  indexTenantRepository,
  isIndexError: isRepositoryIndexRouteError,
  isKnownError: isKnownRepositoryConnectRouteError,
});

// Indexing runs inline; large repositories need more than the default function duration.
export const maxDuration = 300;
