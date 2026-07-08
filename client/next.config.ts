import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/q-dev";

const nextConfig: NextConfig = {
  basePath,
  output: "export",
  trailingSlash: true,
};

export default nextConfig;
