const TENANT_PREFIX = "/o";
const DEFAULT_TENANT_APP_PATH = "/dashboard";

function normalizeAppPath(appPath: string): string {
  if (!appPath || appPath === "/") {
    return DEFAULT_TENANT_APP_PATH;
  }

  return appPath.startsWith("/") ? appPath : `/${appPath}`;
}

export function buildTenantRootPath(workspaceSlug: string): string {
  return `${TENANT_PREFIX}/${encodeURIComponent(workspaceSlug.trim())}`;
}

export function buildTenantAppPath(workspaceSlug: string, appPath: string): string {
  return `${buildTenantRootPath(workspaceSlug)}${normalizeAppPath(appPath)}`;
}

export function extractWorkspaceSlugFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/o\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function stripTenantPathPrefix(pathname: string): string {
  const match = pathname.match(/^\/o\/[^/]+(\/.*)?$/i);
  return match?.[1] ?? (pathname.startsWith(`${TENANT_PREFIX}/`) ? "/" : pathname);
}

export function buildTenantAwareAppPath(pathname: string, appPath: string): string {
  const workspaceSlug = extractWorkspaceSlugFromPathname(pathname);
  return workspaceSlug ? buildTenantAppPath(workspaceSlug, appPath) : normalizeAppPath(appPath);
}

export function withWorkspaceSlugQuery(path: string, workspaceSlug: string): string {
  const url = new URL(path, "https://savant.local");
  url.searchParams.set("workspaceSlug", workspaceSlug);
  return `${url.pathname}${url.search}`;
}
