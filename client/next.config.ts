import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/q-dev";
const isExport = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  basePath,
  ...(isExport && {
    output: "export",
    trailingSlash: true,
  }),
};

export default nextConfig;
