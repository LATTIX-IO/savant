import type { MetadataRoute } from "next";

import { isIndexableDeployment, PUBLIC_ROUTES, resolveSiteOrigin } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  if (!isIndexableDeployment()) {
    return [];
  }

  const origin = resolveSiteOrigin();
  const lastModified = new Date();

  return PUBLIC_ROUTES.filter((route) => route.indexable !== false).map((route) => ({
    url: `${origin}${route.path === "/" ? "" : route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
