/**
 * Electron main process — QVideoChat desktop shell.
 *
 * Loads the static-exported Next.js app (client/out/) into a BrowserWindow
 * via a custom `app://` protocol so root-relative URLs (`/_next/…`,
 * `/models/…`, `/sherpa-asr/…`) resolve correctly. `file://` cannot be
 * used directly because the exported HTML references `/foo` which would
 * resolve to filesystem root, not the app bundle.
 *
 * The pet window (transparent, always-on-top) lives in electron/pet-window.js
 * and is opened from the tray menu — slice D.
 */

const { app, BrowserWindow, protocol, session, net } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Register `app://` as privileged BEFORE app.whenReady so the loaded pages
// count as a secure origin and `crossOriginIsolated` (needed by sherpa-onnx
// WASM's pthread support) can succeed once COOP/COEP headers land.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// Resolve to client/out/. In dev this file lives at client/electron/main.js
// and the export sits in client/out/. In a packaged build electron-builder
// will copy both under resources/app/ so the same relative path holds.
const OUT_DIR = path.join(__dirname, "..", "out");

/**
 * Wire the `app://` protocol handler. Any URL is resolved as a file inside
 * OUT_DIR; a bare `/` maps to `index.html` so app://qvideochat/ works.
 * Directory URLs (trailing slash) also map to the nested index.html —
 * needed because we compiled with trailingSlash: true (see next.config.ts).
 */
function registerAppProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "" || pathname === "/") {
      pathname = "/index.html";
    } else if (pathname.endsWith("/")) {
      pathname += "index.html";
    } else if (!/\.[a-zA-Z0-9]+$/.test(pathname)) {
      // No file extension, no trailing slash → treat as a next.js route.
      // With trailingSlash:true the exporter wrote `/<name>/index.html`;
      // client-side navigation sometimes strips that trailing slash
      // (next 15 quirk), so we re-attach it before hitting disk.
      pathname += "/index.html";
    }
    const filePath = path.join(OUT_DIR, pathname);
    try {
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      console.error("[protocol] failed:", filePath, err);
      return new Response(`not found: ${pathname}`, { status: 404 });
    }
  });
}

/**
 * Inject COOP/COEP on every response. Static export can't emit per-route
 * headers (see next.config.ts warning during build), so we do it at the
 * transport layer. Matches the web version's headers() config for
 * SharedArrayBuffer / sherpa-onnx pthread support.
 */
function injectCoopCoep() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Cross-Origin-Opener-Policy": ["same-origin"],
        "Cross-Origin-Embedder-Policy": ["credentialless"],
      },
    });
  });
}

/**
 * Auto-grant camera / mic / notifications inside our own app. The desktop
 * shell is not a browser and the "do you allow …" prompts would just be
 * noise — the user already installed the app trusting it. Anything not on
 * the allowlist is still denied.
 */
function autoGrantMediaPermissions() {
  const ALLOWED = new Set([
    "media",
    "camera",
    "microphone",
    "audioCapture",
    "videoCapture",
    "notifications",
  ]);
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback) => callback(ALLOWED.has(permission)),
  );
  session.defaultSession.setPermissionCheckHandler(
    (_webContents, permission) => ALLOWED.has(permission),
  );
  // Newer Chromium API used by getDisplayMedia and some getUserMedia paths.
  if (session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((_req, cb) => cb({}));
  }
}

/** Create the main app window (full UX — matches the web app 1:1). */
function createMainWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    backgroundColor: "#0a0a0a",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL("app://qvideochat/");
  return win;
}

app.whenReady().then(() => {
  registerAppProtocol();
  injectCoopCoep();
  autoGrantMediaPermissions();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
