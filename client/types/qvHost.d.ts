/**
 * Types for the `window.qvHost` bridge exposed by electron/preload.js.
 * Present only when running inside the Electron desktop shell — plain
 * browser sessions will see `window.qvHost === undefined` and every
 * caller should guard accordingly.
 */

import type { BlendshapeFrame, PoseFrame } from "@/hooks/useFaceMesh";

export type PetTarget = "self" | "partner";

export interface QvHostApi {
  openPet: (target?: PetTarget) => Promise<boolean>;
  hidePet: () => Promise<boolean>;
  togglePet: (target?: PetTarget) => Promise<boolean>;
  showMain: () => Promise<boolean>;
  onPetTargetChange: (cb: (target: PetTarget) => void) => () => void;
  /** Main → pet: re-play the boot animation. Fires when openPet is called
   *  against an already-existing pet window (Ctrl+Shift+P toggle back on). */
  onPetReveal: (cb: () => void) => () => void;
  /**
   * Main-window-only: push a MediaPipe blendshape frame to the pet window.
   * Fire-and-forget IPC; safe to call at 30fps. Main process drops silently
   * when no pet is open.
   */
  pushBlendshape: (frame: BlendshapeFrame) => void;
  onBlendshape: (cb: (frame: BlendshapeFrame) => void) => () => void;
  pushPose: (frame: PoseFrame) => void;
  onPose: (cb: (frame: PoseFrame) => void) => () => void;

  /** Minimize the main window to the taskbar. */
  minimizeMain: () => Promise<boolean>;
  /** Toggle maximize/restore. Returns whether it's maximized after. */
  toggleMaximizeMain: () => Promise<boolean>;
  /** Close the main window — goes through the shell's close handler, which
   *  routes to hide-to-tray in the running slice-E setup. */
  closeMain: () => Promise<boolean>;
  isMainMaximized: () => Promise<boolean>;
  onMainMaximizedChange: (cb: (maximized: boolean) => void) => () => void;
  /** Underlying OS ('darwin' | 'win32' | 'linux'). Used by the custom
   *  title bar to hide its own buttons on macOS (native traffic lights). */
  platform: NodeJS.Platform;

  isDesktop: true;
}

declare global {
  interface Window {
    qvHost?: QvHostApi;
  }
}

export {};
