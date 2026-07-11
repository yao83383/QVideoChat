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
  //
  // Cross-Origin-{Opener,Embedder}-Policy on ALL pages: sherpa-onnx's WASM
  // is built with -pthread, which needs SharedArrayBuffer, which the
  // browser only exposes when the page is crossOriginIsolated. COOP
  // "same-origin" + COEP "credentialless" is the modern combo — it isolates
  // us without breaking third-party fetches (HF CDN for translation models,
  // etc.); COEP "require-corp" would require every remote fetch to carry a
  // CORP header, which we can't control.
  async headers() {
    if (isExport) return [];
    const coopCoep = [
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Embedder-Policy", value: "credentialless" },
    ];
    return [
      {
        source: "/:path*",
        headers: coopCoep,
      },
      {
        source: "/models/onnx/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          ...coopCoep,
        ],
      },
      {
        source: "/wasm/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          ...coopCoep,
        ],
      },
      {
        source: "/onnx-wasm/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          ...coopCoep,
        ],
      },
      {
        source: "/sherpa-asr/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
          ...coopCoep,
        ],
      },
    ];
  },
};

export default nextConfig;
