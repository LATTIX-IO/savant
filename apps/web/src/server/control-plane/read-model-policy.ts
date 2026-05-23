import type { ResolvedTenantContext } from "./tenant-context.ts";

type ReadModelContext = Pick<ResolvedTenantContext, "isDevelopmentFallback">;

export function canUseTenantDatabaseReadModel(input: {
  context: ReadModelContext | undefined;
  isDatabaseConfigured: boolean;
}): input is {
  context: ReadModelContext & { isDevelopmentFallback: false };
  isDatabaseConfigured: true;
} {
  return Boolean(
    input.context &&
    input.isDatabaseConfigured &&
    !input.context.isDevelopmentFallback,
  );
}

export function isDevelopmentReadModelFallbackAllowed(input: {
  context: ReadModelContext | undefined;
  nodeEnv?: string;
}): boolean {
  return input.nodeEnv === "development" && (!input.context || input.context.isDevelopmentFallback);
}