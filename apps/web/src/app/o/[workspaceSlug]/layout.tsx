import type { ReactNode } from "react";
import { notFound, redirect } from "next/navigation";

import { SavantShell } from "@/components/savant/app-shell";
import { auth0 } from "@/lib/auth0";
import { buildAuthViewer } from "@/lib/auth0-session";
import { buildTenantAppPath } from "@/lib/tenant-paths";
import {
  resolveTenantMembershipForUser,
  TenantContextError,
  upsertUserTenantPreference,
} from "@/server/control-plane/tenant-context";

export const dynamic = "force-dynamic";

function buildWorkspaceShortLabel(workspaceName: string): string {
  const tokens = workspaceName
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return "SV";
  }

  const [first, second] = tokens;
  return `${first?.[0] ?? "S"}${second?.[0] ?? first?.[1] ?? "V"}`.toUpperCase();
}

export default async function TenantWorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  const session = auth0 ? await auth0.getSession() : null;
  let tenantContext;

  try {
    tenantContext = await resolveTenantMembershipForUser(session?.user, workspaceSlug);
  } catch (error) {
    if (error instanceof TenantContextError) {
      if (error.status === 401) {
        redirect(`/signin?returnTo=${encodeURIComponent(buildTenantAppPath(workspaceSlug, "/dashboard"))}`);
      }

      if (error.status === 404) {
        notFound();
      }
    }

    throw error;
  }

  if (tenantContext.identity && !tenantContext.isDevelopmentFallback) {
    await upsertUserTenantPreference(
      tenantContext.identity.subject,
      tenantContext.tenant.organizationId,
    );
  }

  return (
    <SavantShell
      viewer={buildAuthViewer(session?.user)}
      workspace={{
        name: tenantContext.tenant.workspaceName,
        short: buildWorkspaceShortLabel(tenantContext.tenant.workspaceName),
        env: tenantContext.isDevelopmentFallback ? "development" : "production",
        slug: tenantContext.tenant.workspaceSlug,
      }}
      memberships={tenantContext.memberships.map((membership) => ({
        name: membership.workspaceName,
        short: buildWorkspaceShortLabel(membership.workspaceName),
        env: tenantContext.isDevelopmentFallback ? "development" : "production",
        slug: membership.workspaceSlug,
        isDefault: membership.isDefault,
        isLastUsed: membership.isLastUsed,
      }))}
    >
      {children}
    </SavantShell>
  );
}