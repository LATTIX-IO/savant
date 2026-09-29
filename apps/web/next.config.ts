import path from "node:path";

import type { NextConfig } from "next";

import { isIndexableDeployment, NOINDEX_PATH_PREFIXES, resolveSiteOrigin } from "./src/lib/seo.ts";

const monorepoRoot = path.resolve(__dirname, "../..");
const siteHost = new URL(resolveSiteOrigin()).host;

const NOINDEX_HEADER = { key: "X-Robots-Tag", value: "noindex, nofollow" };

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  reactStrictMode: true,
  transpilePackages: ["@savant/types", "@savant/schemas"],
  typedRoutes: true,
  async headers() {
    // Preview and development deployments must never be indexed, whatever the path.
    if (!isIndexableDeployment()) {
      return [{ source: "/:path*", headers: [NOINDEX_HEADER] }];
    }

    return NOINDEX_PATH_PREFIXES.flatMap((prefix) => [
      { source: prefix, headers: [NOINDEX_HEADER] },
      { source: `${prefix}/:path*`, headers: [NOINDEX_HEADER] },
    ]);
  },
  async redirects() {
    if (siteHost.startsWith("www.")) {
      return [];
    }

    // Fallback for requests that reach the app on www. The edge (Vercel domain
    // redirect or the Cloudflare redirect rule in infra/cloudflare) should
    // answer first with the same permanent redirect.
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: `www.${siteHost}` }],
        destination: `https://${siteHost}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
