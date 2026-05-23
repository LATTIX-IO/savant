import path from "node:path";

import type { NextConfig } from "next";

const monorepoRoot = path.resolve(__dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  reactStrictMode: true,
  transpilePackages: ["@savant/types", "@savant/schemas"],
  typedRoutes: true,
};

export default nextConfig;
