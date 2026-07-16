#!/usr/bin/env node
/**
 * Electron build wrapper. Cleans the previous build (next 15.5 has a known
 * incremental-build stale vendor-chunks bug — see memory:next-15-5-stale-vendor-chunks),
 * then invokes `next build` with the Electron env preset.
 *
 * Env overrides for Electron target:
 *   NEXT_ELECTRON=1               → next.config.ts flips to static export + empty basePath
 *   NEXT_PUBLIC_BASE_PATH=""      → inlined into client bundles so all "${BASE_PATH}/…" URLs
 *                                    become site-root URLs the file:// loader can resolve
 *   NEXT_PUBLIC_APP_VERSION=…     → falls back to a placeholder if not set; override from
 *                                    the environment when packaging a real release
 *
 * SERVER_URL / SOCKET_PATH come from .env.production unchanged — the desktop
 * app connects to the same production signaling server as the web version.
 *
 * Cross-platform: pure Node, no cross-env dependency. Runs on Windows (bash
 * or PowerShell), macOS, Linux.
 */
import { rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const clientRoot = resolve(scriptDir, "..");

console.log("[electron-build] cleaning .next and out …");
await rm(resolve(clientRoot, ".next"), { recursive: true, force: true });
await rm(resolve(clientRoot, "out"), { recursive: true, force: true });

const env = {
  ...process.env,
  NEXT_ELECTRON: "1",
  NEXT_PUBLIC_BASE_PATH: "",
  NEXT_PUBLIC_APP_VERSION:
    process.env.NEXT_PUBLIC_APP_VERSION || "1.4.0.001-electron",
};

console.log("[electron-build] running next build (target=electron export) …");
const result = spawnSync("npm", ["run", "build"], {
  stdio: "inherit",
  env,
  shell: true,
  cwd: clientRoot,
});

if (result.status !== 0) {
  console.error(`[electron-build] next build failed (exit ${result.status})`);
  process.exit(result.status ?? 1);
}

console.log("[electron-build] done. Static export in: client/out/");
