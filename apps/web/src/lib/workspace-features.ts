export type WorkspaceFeatureFlag =
  | "governance-pages"
  | "settings-auth"
  | "settings-notifications"
  | "settings-security";

export type SettingsSectionId =
  | "general"
  | "auth"
  | "ai"
  | "members"
  | "security"
  | "billing"
  | "notifications";

export const SETTINGS_SECTION_IDS = [
  "general",
  "auth",
  "ai",
  "members",
  "security",
  "billing",
  "notifications",
] as const satisfies readonly SettingsSectionId[];

const DEV_ONLY_FEATURE_FLAGS = new Set<WorkspaceFeatureFlag>([
  "governance-pages",
  "settings-auth",
  "settings-notifications",
  "settings-security",
]);

const DEV_ONLY_SETTINGS_SECTIONS = new Set<SettingsSectionId>([
  "auth",
  "security",
  "notifications",
]);

export function isDevelopmentFeatureEnvironment(nodeEnv = process.env.NODE_ENV): boolean {
  return nodeEnv !== "production";
}

export function isWorkspaceFeatureEnabled(
  feature: WorkspaceFeatureFlag,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (DEV_ONLY_FEATURE_FLAGS.has(feature)) {
    return isDevelopmentFeatureEnvironment(nodeEnv);
  }

  return true;
}

export function isGovernanceFeatureEnabled(nodeEnv = process.env.NODE_ENV): boolean {
  return isWorkspaceFeatureEnabled("governance-pages", nodeEnv);
}

export function isSettingsSectionEnabled(
  section: SettingsSectionId,
  nodeEnv = process.env.NODE_ENV,
): boolean {
  if (DEV_ONLY_SETTINGS_SECTIONS.has(section)) {
    return isDevelopmentFeatureEnvironment(nodeEnv);
  }

  return true;
}

export function getVisibleSettingsSectionIds(
  nodeEnv = process.env.NODE_ENV,
): SettingsSectionId[] {
  return SETTINGS_SECTION_IDS.filter((section) => isSettingsSectionEnabled(section, nodeEnv));
}
