import "server-only";

import postgres from "postgres";

export type ControlPlaneEnv = Record<string, string | undefined>;
export type ControlPlaneSql = ReturnType<typeof postgres>;

export function isConfiguredDatabaseValue(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith("<") || trimmed.includes("REPLACE") || trimmed.startsWith("placeholder-")) {
    return false;
  }

  return true;
}

export function readConfiguredDatabaseUrl(env: ControlPlaneEnv = process.env): string | null {
  const value = env.DATABASE_URL;

  if (typeof value !== "string") {
    return null;
  }

  if (!isConfiguredDatabaseValue(value)) {
    return null;
  }

  return value.trim();
}

export const isControlPlaneDatabaseConfigured = Boolean(readConfiguredDatabaseUrl(process.env));

let sqlClient: ControlPlaneSql | null = null;

export function getControlPlaneDatabase(): ControlPlaneSql {
  const databaseUrl = readConfiguredDatabaseUrl(process.env);

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured for the control plane.");
  }

  if (!sqlClient) {
    sqlClient = postgres(databaseUrl, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 5,
      prepare: false,
    });
  }

  return sqlClient;
}
