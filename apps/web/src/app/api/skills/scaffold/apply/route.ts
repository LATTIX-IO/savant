import {
  applySkillScaffoldToRepository,
  SkillScaffoldApplyError,
} from "@/server/control-plane/skill-scaffold-apply";
import { authorizeTenantRequest, TenantContextError } from "@/server/control-plane/tenant-context";
import {
  RepositoryProviderConnectionError,
} from "@/server/control-plane/repository-provider-connection";
import { RepositoryProviderError } from "@/server/control-plane/repository-provider-read";
import { readJsonObject } from "@/server/control-plane/request-validation";
import { TenantWriteAccessError } from "@/server/control-plane/tenant-write-access";
import type { RouteHandledError } from "@/server/control-plane/write-route-handlers";
import { createSkillScaffoldApplyPostHandler } from "@/server/control-plane/write-route-handlers";

function isKnownSkillScaffoldApplyRouteError(error: unknown): error is RouteHandledError {
  return error instanceof SkillScaffoldApplyError
    || error instanceof RepositoryProviderConnectionError
    || error instanceof RepositoryProviderError
    || error instanceof TenantWriteAccessError
    || error instanceof TenantContextError;
}

export const POST = createSkillScaffoldApplyPostHandler({
  authorizeTenantRequest,
  readJsonObject,
  applySkillScaffoldToRepository,
  isKnownError: isKnownSkillScaffoldApplyRouteError,
});