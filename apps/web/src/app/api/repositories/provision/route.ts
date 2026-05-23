import {
  RepositoryProvisionError,
  provisionTenantRepository,
} from "@/server/control-plane/repository-provision";
import {
  RepositoryProviderConnectionError,
} from "@/server/control-plane/repository-provider-connection";
import { RepositoryProviderError } from "@/server/control-plane/repository-provider-read";
import { readJsonObject } from "@/server/control-plane/request-validation";
import {
  RepositoryRequestError,
  resolveRepositoryProvisionRequest,
} from "@/server/control-plane/repository-request";
import { validateTenantSkillRepoContract } from "@/server/control-plane/repository-scaffold";
import {
  authorizeTenantRequest,
  TenantContextError,
} from "@/server/control-plane/tenant-context";
import { TenantWriteAccessError } from "@/server/control-plane/tenant-write-access";
import type { RouteHandledError } from "@/server/control-plane/write-route-handlers";
import { createRepositoryProvisionPostHandler } from "@/server/control-plane/write-route-handlers";

function isKnownRepositoryProvisionRouteError(error: unknown): error is RouteHandledError {
  return error instanceof RepositoryProviderError
    || error instanceof RepositoryRequestError
    || error instanceof RepositoryProviderConnectionError
    || error instanceof RepositoryProvisionError
    || error instanceof TenantWriteAccessError
    || error instanceof TenantContextError;
}

export const POST = createRepositoryProvisionPostHandler({
  authorizeTenantRequest,
  readJsonObject,
  resolveRepositoryProvisionRequest,
  validateTenantSkillRepoContract,
  provisionTenantRepository,
  isKnownError: isKnownRepositoryProvisionRouteError,
});