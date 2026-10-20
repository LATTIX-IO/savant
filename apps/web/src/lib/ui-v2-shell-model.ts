import { buildTenantAppPath } from "./tenant-paths.ts";
import { buildSavantShellBreadcrumbs, type SavantShellCounts, type SavantShellCrumb } from "./shell-state.ts";

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

/** Canonical destinations are the actual Next.js tenant routes, never prototype-only URLs. */
export type UiV2RouteResolution =
  | { kind: "collection"; navId: UiV2NavId; appPath: string; resourceId: null }
  | { kind: "detail"; navId: "skills" | "evaluations" | "catalog"; appPath: string; resourceId: string }
  | { kind: "unavailable"; navId: null; appPath: string; resourceId: null };

const DETAIL_ROOTS = new Set(["skills", "evaluations", "catalog"]);
const SAFE_RESOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Fail closed for encoded traversal/redirects, malformed IDs and undeclared nested routes.
 * Next's routing and BFF still own the actual resource authorization and 403/404.
 */
export function resolveUiV2Route(appPath: string): UiV2RouteResolution {
  const unavailable = { kind: "unavailable" as const, navId: null,
    appPath, resourceId: null };
  if (typeof appPath !== "string" || appPath.length > 2048 ||
      !appPath.startsWith("/") || appPath.includes("//") ||
      /[%?#\\\\]/.test(appPath) || /[\x00-\x1f\x7f]/.test(appPath)) {
    return unavailable;
  }
  const normalized = appPath === "/" ? "/dashboard" : appPath;
  const route = NAVIGATION.find(item => item.appPath === normalized);
  if (route) return { kind: "collection", navId: route.id,
    appPath: normalized, resourceId: null };

  const parts = normalized.split("/");
  if (parts.length !== 3 || !DETAIL_ROOTS.has(parts[1] ?? "")) return unavailable;
  const resourceId = parts[2] ?? "";
  if (!SAFE_RESOURCE_ID.test(resourceId) || resourceId === "." || resourceId === "..") {
    return unavailable;
  }
  return { kind: "detail", navId: parts[1] as "skills" | "evaluations" | "catalog",
    appPath: normalized, resourceId };
}

/** Server-owned breadcrumb data; never route arbitrary user-supplied targets. */
export function buildUiV2RouteCrumbs(
  workspaceSlug: string, appPath: string, options: { skillTitle?: string | null } = {},
) {
  const route = resolveUiV2Route(appPath);
  if (route.kind === "unavailable") {
    return buildUiV2Crumbs(workspaceSlug, [
      ["Workspace", null], ["Page unavailable", "current"],
    ]);
  }
  if (route.kind === "detail" && route.navId === "catalog") {
    return buildUiV2Crumbs(workspaceSlug, [
      ["Workspace", null], ["Marketplace", "/catalog"], ["Skill", "current"],
    ]);
  }
  return buildUiV2Crumbs(workspaceSlug,
    buildSavantShellBreadcrumbs(route.appPath, options));
}

export type UiV2NavItem = NavSpec & { href: string; active: boolean; count: number | null };

export function getUiV2Navigation(
  workspaceSlug: string,
  appPath: string,
  counts: SavantShellCounts,
  governanceEnabled: boolean,
): UiV2NavItem[] {
  const activeId = resolveUiV2Route(appPath).navId;
  return NAVIGATION
    .filter(item => !item.governance || governanceEnabled)
    .map(item => ({
      ...item,
      href: buildTenantAppPath(workspaceSlug, item.appPath),
      active: activeId === item.id,
      count: item.countKey ? counts[item.countKey] : null,
    }));
}

// On tenant switch, never carry an object ID (e.g. skill/evaluation UUID) across workspaces.
// Even when an object happens to have the same ID, its authorization is tenant-specific.
export function buildUiV2WorkspaceSwitchPath(nextSlug: string, currentAppPath: string): string {
  const route = resolveUiV2Route(currentAppPath);
  const safePath = route.kind === "collection" ? route.appPath : "/dashboard";
  return buildTenantAppPath(nextSlug, safePath);
}

export function buildUiV2Crumbs(workspaceSlug: string, crumbs: readonly SavantShellCrumb[]) {
  return crumbs.map(([label, target]) => ({
    label,
    href: typeof target === "string" && NAVIGATION.some(item => item.appPath === target) ?
      buildTenantAppPath(workspaceSlug, target) : null,
    current: target === "current",
  }));
}

// UI exposure is an allowlist-only, server-side rollout decision, NOT an entitlement.
// Called *after* resolveTenantMembershipForUser; no client/query/localStorage override.
export function isUiV2EnabledForWorkspace(
  workspaceSlug: string,
  config: { enabled?: string | undefined; workspaces?: string | undefined },
): boolean {
  if (config.enabled !== "true" || !workspaceSlug || !config.workspaces) return false;
  const allowed = config.workspaces.split(",").map(slug => slug.trim()).filter(Boolean);
  return allowed.includes("*") || allowed.includes(workspaceSlug);
}
