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
  /**
   * Main-window-only: push a MediaPipe blendshape frame to the pet window.
   * Fire-and-forget IPC; safe to call at 30fps. Main process drops silently
   * when no pet is open.
   */
  pushBlendshape: (frame: BlendshapeFrame) => void;
  onBlendshape: (cb: (frame: BlendshapeFrame) => void) => () => void;
  pushPose: (frame: PoseFrame) => void;
  onPose: (cb: (frame: PoseFrame) => void) => () => void;
  isDesktop: true;
}

declare global {
  interface Window {
    qvHost?: QvHostApi;
  }
}

export {};
