import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  typedRoutes: true,
  // Workspace packages ship TypeScript source, so Next.js compiles them.
  transpilePackages: ["@beekeeping/db", "@beekeeping/services"],
};

export default nextConfig;
