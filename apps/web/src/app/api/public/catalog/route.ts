import { NextResponse } from "next/server";

import { catalogStats, listCatalog, listCatalogSources } from "@/server/hub/catalog-read";

/** Public, read-only skill catalog. No authentication; nothing tenant-specific. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const { getControlPlaneDatabase } = await import("@/server/control-plane/database");
  const sql = getControlPlaneDatabase();
  const [list, sources, stats] = await Promise.all([
    listCatalog(sql, {
      q: params.get("q"),
      source: params.get("source"),
      verdict: params.get("verdict"),
      limit: Number(params.get("limit")) || 48,
      offset: Number(params.get("offset")) || 0,
    }),
    listCatalogSources(sql),
    catalogStats(sql),
  ]);
  return NextResponse.json(
    { data: { ...list, sources, stats } },
    { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600", "Access-Control-Allow-Origin": "*" } },
  );
}
