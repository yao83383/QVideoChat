import type { NextConfig } from "next";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/q-dev";
const isExport = process.env.NEXT_EXPORT === "1";

const nextConfig: NextConfig = {
  basePath,
  ...(isExport && {
    output: "export",
    trailingSlash: true,
  }),
  // Long-lived caching for AI model files. Content is addressed by path
  // (files never change — a new model would live at a new path), so
  // immutable + 1 year is safe and lets the browser skip revalidation
  // entirely on subsequent visits. Without this, next.js's default is
  // max-age=0 and every reload re-fetches ~110MB per language pair.
  async headers() {
    if (isExport) return [];
    return [
      {
        source: "/models/onnx/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/wasm/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/onnx-wasm/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
