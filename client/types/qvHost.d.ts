/**
 * Types for the `window.qvHost` bridge exposed by electron/preload.js.
 * Present only when running inside the Electron desktop shell — plain
 * browser sessions will see `window.qvHost === undefined` and every
 * caller should guard accordingly.
 */

export type PetTarget = "self" | "partner";

export interface QvHostApi {
  openPet: (target?: PetTarget) => Promise<boolean>;
  hidePet: () => Promise<boolean>;
  togglePet: (target?: PetTarget) => Promise<boolean>;
  showMain: () => Promise<boolean>;
  onPetTargetChange: (cb: (target: PetTarget) => void) => () => void;
  isDesktop: true;
}

declare global {
  interface Window {
    qvHost?: QvHostApi;
  }
}

export {};
