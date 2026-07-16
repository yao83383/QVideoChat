/**
 * Electron main process — QVideoChat desktop shell.
 *
 * Loads the static-exported Next.js app (client/out/) into a BrowserWindow
 * via a custom `app://` protocol so root-relative URLs (`/_next/…`,
 * `/models/…`, `/sherpa-asr/…`) resolve correctly. `file://` cannot be
 * used directly because the exported HTML references `/foo` which would
 * resolve to filesystem root, not the app bundle.
 *
 * Windows:
 *   - main window: full app UX at app://qvideochat/
 *   - pet window: single-avatar desktop pet at app://qvideochat/pet/?target=…
 *     transparent + frameless + always-on-top, opened via IPC or a global
 *     Ctrl+Shift+P shortcut (dev toggle until slice E adds the tray icon).
 */

const {
  app,
  BrowserWindow,
  protocol,
  session,
  net,
  ipcMain,
  globalShortcut,
  screen,
} = require("electron");
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

// Windows-only occlusion detection: Chromium normally decides a covered or
// off-screen window is "occluded" and throttles its render + timers even
// with backgroundThrottling: false in place. That would make the main
// window stop pushing MediaPipe frames the moment the user hides it, so
// the pet freezes. Disabling this feature keeps rAF + setInterval running
// at full rate regardless of window visibility.
app.commandLine.appendSwitch(
  "disable-features",
  "CalculateNativeWinOcclusion",
);

// Resolve to client/out/. In dev this file lives at client/electron/main.js
// and the export sits in client/out/. In a packaged build electron-builder
// will copy both under resources/app/ so the same relative path holds.
const OUT_DIR = path.join(__dirname, "..", "out");

// Tracked so IPC handlers can hand back the same window on repeated
// pet:open calls, and so `app.on('before-quit')` can distinguish
// intentional shutdowns from user-hiding a window.
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let petWindow = null;
let isQuittingApp = false;

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
      // Chromium throttles requestAnimationFrame + video pipelines on hidden
      // windows by default, which would freeze useFaceMesh the moment the
      // user minimizes or hides the main window — killing the blendshape
      // stream the pet subscribes to. Disable throttling so the shell can
      // fade to background while still driving the pet.
      backgroundThrottling: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.loadURL("app://qvideochat/");

  // Close-button behavior:
  //   pet visible → hide the main window instead of destroying it. Destroying
  //     the renderer tears down MediaPipe + camera stream, and the pet has no
  //     way to reacquire them without a full-app relaunch.
  //   pet not visible → really close (mainWindow becomes null, and if pet is
  //     also gone `window-all-closed` will quit the app on non-macOS).
  win.on("close", (e) => {
    if (isQuittingApp) return;
    if (
      petWindow &&
      !petWindow.isDestroyed() &&
      petWindow.isVisible()
    ) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = win;
  return win;
}

/**
 * Create (or reveal) the pet window. Idempotent: repeated calls just
 * `show()` + `focus()` the existing window instead of stacking a second
 * transparent overlay.
 *
 * Positioning: bottom-right of the primary display's work area (respects
 * taskbar height on Windows / dock on macOS). No user-relocatable memory
 * yet — that lands with the tray in slice E.
 *
 * @param {"self" | "partner"} target
 */
function openPetWindow(target = "self") {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
    petWindow.webContents.send("qv:pet:target", target);
    return petWindow;
  }

  const WIDTH = 320;
  const HEIGHT = 400;
  const MARGIN = 20;
  const { workArea } = screen.getPrimaryDisplay();
  const x = workArea.x + workArea.width - WIDTH - MARGIN;
  const y = workArea.y + workArea.height - HEIGHT - MARGIN;

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    hasShadow: false,
    skipTaskbar: true,
    focusable: true,
    // `screen-saver` puts the pet above full-screen apps too. Some users
    // find this too aggressive — slice E's settings will expose a toggle.
    alwaysOnTop: true,
    show: false,
    // Prevent white flash on load; the pet page will make body transparent
    // once React mounts, but until then this keeps the frameless rect from
    // painting white/black over the desktop wallpaper.
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Same rationale as the main window: keep the VRM animation loop
      // running when the pet is behind other apps or on another workspace.
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.once("ready-to-show", () => win.show());
  win.loadURL(`app://qvideochat/pet/?target=${encodeURIComponent(target)}`);

  // Close button in the pet HUD calls `window.close()` — intercept and hide
  // instead so the user can toggle the pet back on without a full reload of
  // MediaPipe + VRM (~30MB of one-time cost).
  win.on("close", (e) => {
    if (!isQuittingApp) {
      e.preventDefault();
      win.hide();
    }
  });

  win.on("closed", () => {
    petWindow = null;
  });

  petWindow = win;
  return win;
}

/** IPC contract exposed via preload.js → window.qvHost.* */
function registerIpc() {
  ipcMain.handle("qv:pet:open", (_e, target) => {
    openPetWindow(target === "partner" ? "partner" : "self");
    return true;
  });

  ipcMain.handle("qv:pet:hide", () => {
    if (petWindow && !petWindow.isDestroyed()) petWindow.hide();
    return true;
  });

  ipcMain.handle("qv:pet:toggle", (_e, target) => {
    if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
      petWindow.hide();
    } else {
      openPetWindow(target === "partner" ? "partner" : "self");
    }
    return true;
  });

  ipcMain.handle("qv:main:show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
    return true;
  });

  // Blendshape / pose forward channel. Renderer → main → pet. `.send` is
  // fire-and-forget so the ~30fps hot path stays cheap; we drop silently
  // if pet isn't up or is hidden (nothing to render behind hidden window).
  ipcMain.on("qv:blendshape:push", (_e, frame) => {
    if (
      petWindow &&
      !petWindow.isDestroyed() &&
      petWindow.isVisible() &&
      !petWindow.webContents.isCrashed()
    ) {
      petWindow.webContents.send("qv:blendshape", frame);
    }
  });

  ipcMain.on("qv:pose:push", (_e, frame) => {
    if (
      petWindow &&
      !petWindow.isDestroyed() &&
      petWindow.isVisible() &&
      !petWindow.webContents.isCrashed()
    ) {
      petWindow.webContents.send("qv:pose", frame);
    }
  });
}

/**
 * Global dev-toggle: Ctrl+Shift+P anywhere on the OS opens or hides the pet
 * window. Slice E adds a tray icon + main-window button as the "real" UX;
 * this shortcut stays as a power-user affordance.
 */
function registerGlobalShortcuts() {
  const ok = globalShortcut.register("CommandOrControl+Shift+P", () => {
    if (petWindow && !petWindow.isDestroyed() && petWindow.isVisible()) {
      petWindow.hide();
    } else {
      openPetWindow("self");
    }
  });
  if (!ok) console.warn("[shortcut] failed to register Ctrl+Shift+P");
}

app.whenReady().then(() => {
  registerAppProtocol();
  injectCoopCoep();
  autoGrantMediaPermissions();
  registerIpc();
  registerGlobalShortcuts();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", () => {
  isQuittingApp = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
