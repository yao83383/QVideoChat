/**
 * Preload script — runs in an isolated Node context that has access to
 * the renderer's DOM. Exposes a minimal `window.qvHost` API so the web
 * bundle can talk to the shell without having full nodeIntegration.
 *
 * All calls round-trip through ipcRenderer.invoke so the main process can
 * validate and (later) rate-limit. Handlers live in electron/main.js.
 */

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("qvHost", {
  /** Open (or reveal) the pet window in the given mode. Idempotent. */
  openPet: (target = "self") => ipcRenderer.invoke("qv:pet:open", target),
  /** Hide the pet without destroying it — cheap to bring back later. */
  hidePet: () => ipcRenderer.invoke("qv:pet:hide"),
  /** Toggle: open with `target` when hidden, hide when visible. */
  togglePet: (target = "self") =>
    ipcRenderer.invoke("qv:pet:toggle", target),
  /** Bring the main app window to the front (used from pet HUD). */
  showMain: () => ipcRenderer.invoke("qv:main:show"),
  /**
   * Subscribe to target-switch commands pushed from the main process
   * (e.g. tray menu changes the pet's mode).
   * @param {(target: 'self' | 'partner') => void} cb
   * @returns {() => void} unsubscribe
   */
  onPetTargetChange: (cb) => {
    const handler = (_e, target) => cb(target);
    ipcRenderer.on("qv:pet:target", handler);
    return () => ipcRenderer.removeListener("qv:pet:target", handler);
  },

  // --- Blendshape bridge ------------------------------------------------
  //
  // The main window is the *only* place that runs MediaPipe. A second
  // FaceLandmarker in the pet window OOMs the WASM memory (32-bit wasm
  // caps around ~2GB per instance and the two share the renderer process's
  // v8 heap on same-origin BrowserWindows). Instead, the main window pushes
  // 30fps blendshape/pose frames over IPC and the pet subscribes.
  //
  // ipcRenderer.send is fire-and-forget for hot paths — no promise round-
  // trip, no ack — because ~30fps × 2KB payloads add up otherwise.

  /** Main window → main process → pet window. Silent no-op if no pet. */
  pushBlendshape: (frame) => ipcRenderer.send("qv:blendshape:push", frame),
  /**
   * Pet window subscription.
   * @param {(frame: import("../hooks/useFaceMesh").BlendshapeFrame) => void} cb
   */
  onBlendshape: (cb) => {
    const handler = (_e, frame) => cb(frame);
    ipcRenderer.on("qv:blendshape", handler);
    return () => ipcRenderer.removeListener("qv:blendshape", handler);
  },
  /** Same shape as blendshape, separate channel for the pose stream. */
  pushPose: (frame) => ipcRenderer.send("qv:pose:push", frame),
  onPose: (cb) => {
    const handler = (_e, frame) => cb(frame);
    ipcRenderer.on("qv:pose", handler);
    return () => ipcRenderer.removeListener("qv:pose", handler);
  },

  /** True when running inside the Electron shell (window.qvHost exists). */
  isDesktop: true,
});
