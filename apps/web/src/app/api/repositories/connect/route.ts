import {
  connectTenantRepository,
  RepositoryConnectError,
} from "@/server/control-plane/repository-connect";
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

export const POST = createRepositoryConnectPostHandler({
  authorizeTenantRequest,
  readJsonObject,
  resolveRepositoryConnectRequest,
  validateTenantSkillRepoContract,
  connectTenantRepository,
  ensureRepositoryWebhookRegistration,
  isKnownError: isKnownRepositoryConnectRouteError,
});
