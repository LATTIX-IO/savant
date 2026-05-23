import {
  indexTenantRepository,
  RepositoryIndexError,
} from "@/server/control-plane/repository-index";
import { RepositoryProviderError } from "@/server/control-plane/repository-provider-read";
import { readJsonObject } from "@/server/control-plane/request-validation";
import {
  requestTenantRepositorySync,
  RepositorySyncError,
} from "@/server/control-plane/repository-sync";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import { TenantWriteAccessError } from "@/server/control-plane/tenant-write-access";
import type { RouteHandledError } from "@/server/control-plane/write-route-handlers";
import { createRepositorySyncPostHandler } from "@/server/control-plane/write-route-handlers";

function isKnownRepositorySyncRouteError(error: unknown): error is RouteHandledError {
  return error instanceof RepositorySyncError
    || error instanceof RepositoryIndexError
    || error instanceof RepositoryProviderError
    || error instanceof TenantWriteAccessError
    || error instanceof TenantContextError;
}

export const POST = createRepositorySyncPostHandler({
  authorizeTenantRequest,
  readJsonObject,
  requestTenantRepositorySync,
  indexTenantRepository,
  isKnownError: isKnownRepositorySyncRouteError,
});