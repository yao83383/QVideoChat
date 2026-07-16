/**
 * Preload script — runs in an isolated Node context that has access to
 * the renderer's DOM. Used to expose a minimal, hand-picked API surface
 * (`window.qvHost`) instead of full nodeIntegration, so the web bundle
 * can't reach into Node.
 *
 * Slice B keeps this empty on purpose — the main app doesn't need to talk
 * to the shell yet. Slice D/E will wire up messages for pet-window control
 * (show/hide/switch target) via ipcRenderer.
 */

// const { contextBridge, ipcRenderer } = require("electron");
// contextBridge.exposeInMainWorld("qvHost", { /* pet.show(), tray commands, … */ });
