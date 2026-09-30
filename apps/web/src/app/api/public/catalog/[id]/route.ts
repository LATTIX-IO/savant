import { NextResponse } from "next/server";

import { getCatalogSkill } from "@/server/hub/catalog-read";

/** Public, read-only detail for one catalog skill: upstream package metadata, SKILL.md and Savant's analysis. */
export async function GET(_request: Request, ctx: RouteContext<"/api/public/catalog/[id]">) {
  const { id } = await ctx.params;
  const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
  const skill = await getCatalogSkill(getControlPlaneDatabase(), id);
  if (!skill) {
    return NextResponse.json({ error: { code: "NOT_FOUND", message: "Catalog skill not found." } }, { status: 404 });
  }
  return NextResponse.json({ data: skill }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600", "Access-Control-Allow-Origin": "*" } });
}
