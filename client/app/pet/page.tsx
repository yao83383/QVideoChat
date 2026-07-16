"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import VrmAvatar from "@/components/VrmAvatar";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";

/**
 * /pet — desktop-pet content layer.
 *
 * Rendered inside the Electron pet BrowserWindow (transparent · alwaysOnTop ·
 * frameless — see electron/main.js in slice D). Deliberately empty framing:
 * just a small drag strip up top and one big VrmAvatar in the middle.
 *
 * `?target=self` (default) drives the avatar from the local camera via
 * useFaceMesh, mirroring the user like a small desktop mirror.
 * `?target=partner` will subscribe to a peer's blendshape stream — that
 * needs socket + WebRTC plumbing and lands in slice E; for now it shows a
 * placeholder so the switch button already works end-to-end.
 *
 * Body background gets forced transparent via a `pet-body` class effect so
 * the surrounding BrowserWindow's transparency actually shows through. In
 * a normal browser tab you'll see the dark app background instead — that's
 * fine for dev debugging.
 */

type Target = "self" | "partner";

function PetView() {
  const sp = useSearchParams();
  const router = useRouter();
  const target = ((sp.get("target") as Target) || "self") as Target;

  const { blendshapeRef, poseRef, start, stop, faceFound, error, isLoaded, step } =
    useFaceMesh();
  const { selectedEntry } = useSelectedAvatar();

  // Camera auto-start only when we're rendering our own face. Cleanup on
  // unmount OR when the user flips to partner mode.
  useEffect(() => {
    if (target !== "self") return;
    start();
    return () => stop();
  }, [target, start, stop]);

  // Force body / html transparent so the OS-level compositing behind the
  // BrowserWindow (desktop wallpaper) shows through the transparent regions.
  // Reverting on unmount keeps browser-tab debug sessions well-behaved.
  useEffect(() => {
    const bodyPrev = document.body.style.background;
    const htmlPrev = document.documentElement.style.background;
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
    document.body.classList.add("pet-body");
    return () => {
      document.body.style.background = bodyPrev;
      document.documentElement.style.background = htmlPrev;
      document.body.classList.remove("pet-body");
    };
  }, []);

  const switchTarget = () => {
    const next: Target = target === "self" ? "partner" : "self";
    router.replace(`/pet?target=${next}`);
  };

  // Slice B–D use window.close() which the Electron BrowserWindow interprets
  // as "hide" via the close handler (main.js). In a plain browser tab it just
  // closes the tab — acceptable dev-mode behavior.
  const closePet = () => {
    try { window.close(); } catch { /* ignore */ }
  };

  return (
    <main className="min-h-screen w-screen flex flex-col bg-transparent">
      {/* HUD strip. `qv-drag-region` = draggable by the whole strip;
          `.qv-no-drag` on child buttons keeps them clickable. Both CSS
          properties are `-webkit-app-region` — no-ops in a regular browser. */}
      <div className="qv-drag-region flex items-center justify-between px-3 py-1.5 text-[10px] select-none">
        <button
          type="button"
          onClick={switchTarget}
          className="qv-no-drag rounded-full bg-black/40 hover:bg-black/60 text-white/80 px-2.5 py-1 transition"
          title="切换显示对象"
        >
          {target === "self" ? "👤 自己" : "👥 对方"} · 换
        </button>
        <button
          type="button"
          onClick={closePet}
          aria-label="关闭桌宠"
          className="qv-no-drag w-6 h-6 rounded-full bg-black/40 hover:bg-red-600/70 text-white/70 hover:text-white text-sm leading-none transition"
        >
          ×
        </button>
      </div>

      {/* Avatar canvas centered in whatever window size the shell picks.
          Placing the avatar in a flex-1 wrapper lets the pet window resize
          without reshaping the character — the mount just re-centers it. */}
      <div className="qv-no-drag flex-1 flex items-center justify-center overflow-hidden">
        {target === "self" ? (
          <VrmAvatar
            blendshapeRef={blendshapeRef}
            poseRef={poseRef}
            size={260}
            vrmPath={selectedEntry.vrmPath}
            placeholderEmoji={selectedEntry.emoji}
            placeholderTint={selectedEntry.tint}
            mirror
          />
        ) : (
          <PartnerPlaceholder />
        )}
      </div>

      {/* Bottom-edge status text. Kept ultra-quiet so the pet reads as
          decoration when everything's fine. Only surfaces problems. */}
      <div className="qv-no-drag min-h-[16px] flex items-center justify-center text-[10px] text-white/50 select-none pb-1">
        {target === "self" && error && <span className="text-red-400">{error}</span>}
        {target === "self" && !error && step && !isLoaded && `加载: ${step}`}
        {target === "self" && !error && isLoaded && !faceFound && "未检测到人脸"}
      </div>
    </main>
  );
}

/**
 * Placeholder for partner mode. Slice E will replace this with a mounted
 * useSocket + usePeer pair (self-contained mini-room inside the pet window),
 * so opening the pet in partner mode with no active call auto-queues a match.
 */
function PartnerPlaceholder() {
  return (
    <div className="flex flex-col items-center gap-2 text-white/60 text-xs px-4 text-center">
      <span className="text-4xl">👥</span>
      <p>对方桌宠模式即将上线</p>
      <p className="text-white/40 text-[10px]">v1.4-E 将接入独立通话入口</p>
    </div>
  );
}

export default function PetPage() {
  return (
    <Suspense
      fallback={<div className="min-h-screen w-screen bg-transparent" />}
    >
      <PetView />
    </Suspense>
  );
}
