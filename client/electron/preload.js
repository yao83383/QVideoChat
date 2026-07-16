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
  /** True when running inside the Electron shell (window.qvHost exists). */
  isDesktop: true,
});
