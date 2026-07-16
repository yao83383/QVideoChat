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
 *     transparent + frameless + always-on-top
 *   - system tray icon (slice E): purple Q, click to reveal main window,
 *     right-click menu for pet toggle + explicit quit. Closing any window
 *     `.hide()`s it — the tray is the only path to real termination.
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
  Tray,
  Menu,
  nativeImage,
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

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {BrowserWindow | null} */
let petWindow = null;
/** @type {Tray | null} */
let tray = null;
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

/**
 * DevTools toggle via a per-window shortcut. Global shortcuts would swallow
 * Ctrl+Shift+I everywhere on the OS which is rude; before-input-event only
 * fires when this window has focus.
 */
function bindDevtoolsShortcut(win) {
  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const isDev = input.control && input.shift && input.key.toLowerCase() === "i";
    const isReload = input.control && !input.shift && input.key.toLowerCase() === "r";
    if (isDev) {
      win.webContents.toggleDevTools();
      event.preventDefault();
    } else if (isReload) {
      win.reload();
      event.preventDefault();
    }
  });
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
  bindDevtoolsShortcut(win);

  // Close-button behavior:
  //   Always hide → the tray keeps the app resident and MediaPipe alive so
  //   the pet keeps rendering. Real quit only from tray "退出" (which flips
  //   isQuittingApp and lets this handler pass through).
  //   setSkipTaskbar(true) removes the taskbar entry so the "hidden" state
  //   reads as "sent to tray" instead of "still there, just invisible".
  win.on("close", (e) => {
    if (isQuittingApp) return;
    e.preventDefault();
    win.hide();
    win.setSkipTaskbar(true);
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  mainWindow = win;
  return win;
}

function revealMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  // Reverse whatever hide() did: put it back on the taskbar and raise it.
  mainWindow.setSkipTaskbar(false);
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

/**
 * Create (or reveal) the pet window. Idempotent: repeated calls just
 * `show()` + `focus()` the existing window instead of stacking a second
 * transparent overlay.
 *
 * Positioning: bottom-right of the primary display's work area (respects
 * taskbar height on Windows / dock on macOS).
 *
 * @param {"self" | "partner"} target
 */
function openPetWindow(target = "self") {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
    petWindow.webContents.send("qv:pet:target", target);
    // Re-play the boot animation on every reveal — first mount handles
    // itself, but Ctrl+Shift+P toggle-back-on needs a nudge because the
    // renderer never unmounts between hides.
    petWindow.webContents.send("qv:pet:reveal");
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
    // find this too aggressive — future settings toggle can drop it back.
    alwaysOnTop: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.once("ready-to-show", () => win.show());
  win.loadURL(`app://qvideochat/pet/?target=${encodeURIComponent(target)}`);
  bindDevtoolsShortcut(win);

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

/**
 * Build a purple-circle tray icon in-process — avoids shipping a separate
 * PNG asset until we design a real logo. 32x32 BGRA bitmap; Windows
 * automatically down-samples for the 16x16 tray slot.
 */
function buildTrayIcon() {
  const SIZE = 32;
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - 15.5;
      const dy = y - 15.5;
      const r2 = dx * dx + dy * dy;
      const idx = (y * SIZE + x) * 4;
      if (r2 < 210) {
        // Filled purple (matches the brand gradient's warm end).
        buf[idx] = 247;      // B
        buf[idx + 1] = 85;   // G
        buf[idx + 2] = 168;  // R
        buf[idx + 3] = 255;  // A
      }
      // else: leaves alpha 0 — transparent corners so the icon reads as a circle.
    }
  }
  return nativeImage.createFromBitmap(buf, { width: SIZE, height: SIZE });
}

function createTray() {
  tray = new Tray(buildTrayIcon());
  tray.setToolTip("QVideoChat");

  const menu = Menu.buildFromTemplate([
    {
      label: "显示主窗口",
      click: () => revealMainWindow(),
    },
    {
      label: "显示 / 隐藏桌宠",
      click: () => {
        if (
          petWindow &&
          !petWindow.isDestroyed() &&
          petWindow.isVisible()
        ) {
          petWindow.hide();
        } else {
          openPetWindow("self");
        }
      },
    },
    { type: "separator" },
    {
      label: "退出 QVideoChat",
      click: () => {
        isQuittingApp = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);

  // Left-click on Windows / macOS = reveal the main app. macOS also fires
  // 'double-click' for the same intent; wire both to keep the handler
  // definition in one place.
  tray.on("click", revealMainWindow);
  tray.on("double-click", revealMainWindow);
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
    revealMainWindow();
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
 * Global Ctrl+Shift+P toggles the pet from anywhere on the OS — a
 * power-user shortcut that predates the tray. Kept because muscle memory.
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
  createTray();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else revealMainWindow();
  });
});

app.on("before-quit", () => {
  isQuittingApp = true;
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
});

// Do NOT app.quit() here — the tray keeps the app resident. Users pick
// "退出 QVideoChat" from the tray menu when they really mean it.
app.on("window-all-closed", () => {
  // no-op
});
