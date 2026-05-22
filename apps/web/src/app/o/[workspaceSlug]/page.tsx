import type { Route } from "next";
import { redirect } from "next/navigation";

import { buildTenantAppPath } from "@/lib/tenant-paths";

export default async function TenantWorkspaceIndexPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  redirect(buildTenantAppPath(workspaceSlug, "/dashboard") as Route);
}