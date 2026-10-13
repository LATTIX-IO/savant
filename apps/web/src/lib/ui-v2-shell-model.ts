import { buildTenantAppPath } from "./tenant-paths";
import type { SavantShellCounts, SavantShellCrumb } from "./shell-state";

export type UiV2NavGroup = "workspace" | "library" | "quality" | "integrations" | "governance" | "system";
export type UiV2NavId = "overview" | "skills" | "repositories" | "catalog" | "evaluations" |
  "releases" | "intelligence" | "router" | "connectors" | "policies" | "audit" | "settings";

type NavSpec = {
  id: UiV2NavId;
  label: string;
  appPath: string;
  group: UiV2NavGroup;
  countKey?: keyof SavantShellCounts;
  governance?: boolean;
};

const NAVIGATION: readonly NavSpec[] = [
  { id: "overview", label: "Overview", appPath: "/dashboard", group: "workspace" },
  { id: "skills", label: "Skills", appPath: "/skills", group: "library", countKey: "skills" },
  { id: "repositories", label: "Repositories", appPath: "/repositories", group: "library", countKey: "repositories" },
  { id: "catalog", label: "Marketplace", appPath: "/catalog", group: "library" },
  { id: "evaluations", label: "Evaluations and runs", appPath: "/evaluations", group: "quality", countKey: "evaluations" },
  { id: "intelligence", label: "Insights", appPath: "/intelligence", group: "quality" },
  { id: "releases", label: "Releases", appPath: "/releases", group: "quality", countKey: "releases" },
  { id: "router", label: "Skill router", appPath: "/router", group: "integrations" },
  { id: "connectors", label: "Connectors", appPath: "/connectors", group: "governance", countKey: "connectors", governance: true },
  { id: "policies", label: "Policies", appPath: "/policies", group: "governance", countKey: "policies", governance: true },
  { id: "audit", label: "Audit", appPath: "/audit", group: "governance", governance: true },
  { id: "settings", label: "Settings", appPath: "/settings", group: "system" },
] as const;

export const UI_V2_NAV_GROUPS: Readonly<Record<UiV2NavGroup, string>> = {
  workspace: "Workspace", library: "Library", quality: "Quality",
  integrations: "Integrations", governance: "Governance", system: "Administration",
};

export type UiV2NavItem = NavSpec & { href: string; active: boolean; count: number | null };

export function getUiV2Navigation(
  workspaceSlug: string,
  appPath: string,
  counts: SavantShellCounts,
  governanceEnabled: boolean,
): UiV2NavItem[] {
  return NAVIGATION
    .filter(item => !item.governance || governanceEnabled)
    .map(item => ({
      ...item,
      href: buildTenantAppPath(workspaceSlug, item.appPath),
      active: appPath === item.appPath || appPath.startsWith(item.appPath + "/"),
      count: item.countKey ? counts[item.countKey] : null,
    }));
}

// On tenant switch, never carry an object ID (e.g. skill/evaluation UUID) across workspaces.
// Even when an object happens to have the same ID, its authorization is tenant-specific.
const SAFE_WORKSPACE_SWITCH_PATHS = new Set(NAVIGATION.map(item => item.appPath));
export function buildUiV2WorkspaceSwitchPath(nextSlug: string, currentAppPath: string): string {
  const safePath = SAFE_WORKSPACE_SWITCH_PATHS.has(currentAppPath) ? currentAppPath : "/dashboard";
  return buildTenantAppPath(nextSlug, safePath);
}

export function buildUiV2Crumbs(workspaceSlug: string, crumbs: readonly SavantShellCrumb[]) {
  return crumbs.map(([label, target]) => ({
    label,
    href: typeof target === "string" && target.startsWith("/") ?
      buildTenantAppPath(workspaceSlug, target) : null,
    current: target === "current",
  }));
}

// UI exposure is an allowlist-only, server-side rollout decision, NOT an entitlement.
// Called *after* resolveTenantMembershipForUser; no client/query/localStorage override.
export function isUiV2EnabledForWorkspace(
  workspaceSlug: string,
  config: { enabled?: string; workspaces?: string },
): boolean {
  if (config.enabled !== "true" || !workspaceSlug || !config.workspaces) return false;
  const allowed = config.workspaces.split(",").map(slug => slug.trim()).filter(Boolean);
  return allowed.includes("*") || allowed.includes(workspaceSlug);
}
