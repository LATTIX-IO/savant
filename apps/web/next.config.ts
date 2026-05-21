import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@savant/types", "@savant/schemas"],
  typedRoutes: true,
};

export default nextConfig;
