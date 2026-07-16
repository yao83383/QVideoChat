"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import VrmAvatar from "@/components/VrmAvatar";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";
import type { BlendshapeFrame, PoseFrame } from "@/hooks/useFaceMesh";

/**
 * /pet — desktop-pet content layer.
 *
 * Rendered inside the Electron pet BrowserWindow (transparent · alwaysOnTop ·
 * frameless — see electron/main.js in slice D). Deliberately empty framing:
 * just a small drag strip up top and one big VrmAvatar in the middle.
 *
 * **Self mode does NOT run its own face tracker.** A second MediaPipe
 * FaceLandmarker in the pet window OOMs the wasm memory (both windows
 * share the same-origin renderer process; 32-bit wasm caps around ~2GB
 * per instance and two won't fit). The main window is the sole camera
 * consumer and pushes blendshape/pose frames over IPC via window.qvHost.
 * The pet subscribes and hands the refs straight to VrmAvatar — same
 * shape useFaceMesh would have produced.
 *
 * Consequence: if the main window is closed or the camera is off, the pet
 * shows the avatar's idle rest pose (VrmAvatar's built-in breathing loop).
 * That's an acceptable "still-there but not driven" state.
 *
 * `?target=partner` will subscribe to the peer's blendshape stream instead
 * — needs socket + WebRTC plumbing and lands in slice E.
 *
 * Body background gets forced transparent via a `pet-body` class so the
 * surrounding BrowserWindow's transparency actually shows through. In a
 * normal browser tab you'll see the dark app background instead — that's
 * fine for dev debugging.
 */

type Target = "self" | "partner";

// Four hand-authored reveal animations (see globals.css `qv-boot-<name>-*`).
// Each spec pairs the overlay children with the character-wrapper class so
// the two halves of the effect stay in sync. Adding a fifth = add an entry
// and a matching CSS block; nothing else to wire.
const BOOT_VARIANTS = ["crt", "assemble", "portal", "holo"] as const;
type BootVariant = (typeof BOOT_VARIANTS)[number];

const CHAR_CLASS_BY_VARIANT: Record<BootVariant, string> = {
  crt: "qv-boot-crt-char",
  assemble: "qv-boot-assemble-char",
  portal: "qv-boot-portal-char",
  holo: "qv-boot-holo-char",
};

function pickBootVariant(): BootVariant {
  return BOOT_VARIANTS[Math.floor(Math.random() * BOOT_VARIANTS.length)];
}

function BootOverlayLayers({ variant }: { variant: BootVariant }) {
  switch (variant) {
    case "crt":
      return (
        <>
          <div className="qv-boot-crt-glow" />
          <div className="qv-boot-crt-scan" />
          <div className="qv-boot-crt-flash" />
        </>
      );
    case "assemble":
      return (
        <>
          <div className="qv-boot-assemble-cloud" />
          <div className="qv-boot-assemble-spark" />
        </>
      );
    case "portal":
      return (
        <>
          <div className="qv-boot-portal-ring" />
          <div className="qv-boot-portal-ring-b" />
        </>
      );
    case "holo":
      return (
        <>
          <div className="qv-boot-holo-lines" />
          <div className="qv-boot-holo-scan" />
        </>
      );
  }
}

function PetView() {
  const sp = useSearchParams();
  const router = useRouter();
  const target = ((sp.get("target") as Target) || "self") as Target;
  const { selectedEntry } = useSelectedAvatar();

  // Refs that VrmAvatar reads each render — same contract as useFaceMesh.
  // Populated by IPC pushes from the main window (self) or peer stream (partner,
  // slice E). Never null once we start receiving frames; VrmAvatar tolerates
  // null and falls through to idle animation.
  const blendshapeRef = useRef<BlendshapeFrame | null>(null);
  const poseRef = useRef<PoseFrame | null>(null);

  // "connected" = at least one frame arrived since mount. Used only for the
  // quiet bottom status line; VrmAvatar itself doesn't need this flag.
  const [connected, setConnected] = useState(false);

  // Boot animation gate. `bootTick` increments every time we want to REPLAY
  // — bumping it swaps the key on the overlay + char wrapper, which restarts
  // the CSS animations. React can't diff-then-restart the same animation on
  // the same element otherwise. `booting` gates the overlay's presence and
  // the char's variant class; a timer clears it after the longest variant
  // (assemble @ 1.3s) has safely painted its last frame.
  //
  // `bootVariant` starts fixed at "crt" so the SSR-rendered HTML matches
  // what the client hydrates to (Math.random() at module scope would cause
  // a hydration warning). The first useEffect below immediately pick a real
  // random variant, so users only ever perceive random reveals — the
  // deterministic "crt" is only the SSR/hydration seed and gets overwritten
  // on the same paint frame as the initial boot fires.
  const [bootVariant, setBootVariant] = useState<BootVariant>("crt");
  const [bootTick, setBootTick] = useState(0);
  const [booting, setBooting] = useState(false);
  useEffect(() => {
    if (!booting) return;
    const t = setTimeout(() => setBooting(false), 1500);
    return () => clearTimeout(t);
  }, [booting, bootTick]);

  const triggerBoot = () => {
    setBootVariant(pickBootVariant());
    setBootTick((n) => n + 1);
    setBooting(true);
  };

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

  // Self-mode blendshape/pose subscription. No-op when host missing (plain
  // browser dev) or when target flips to partner. Cleanup detaches both
  // ipcRenderer listeners so a partner→self→partner flip won't leak them.
  useEffect(() => {
    if (target !== "self") return;
    if (typeof window === "undefined" || !window.qvHost) return;
    const unsubB = window.qvHost.onBlendshape((frame) => {
      blendshapeRef.current = frame;
      if (!connected) setConnected(true);
    });
    const unsubP = window.qvHost.onPose((frame) => {
      poseRef.current = frame;
    });
    return () => {
      unsubB();
      unsubP();
    };
    // `connected` intentionally omitted — we want the setState only on the
    // FIRST frame; re-subscribing on every state change would drop frames.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const switchTarget = () => {
    const next: Target = target === "self" ? "partner" : "self";
    router.replace(`/pet?target=${next}`);
    setConnected(false);
  };

  // Main process may push `qv:pet:target` when the same pet window is
  // reopened with a different mode (e.g. tray menu switches to partner).
  // Sync the URL so React re-renders the right branch.
  useEffect(() => {
    if (typeof window === "undefined" || !window.qvHost) return;
    return window.qvHost.onPetTargetChange((next) => {
      router.replace(`/pet?target=${next}`);
      setConnected(false);
    });
  }, [router]);

  // Main process replays the boot animation each time the pet becomes
  // visible after being hidden (Ctrl+Shift+P toggle back on, tray click,
  // etc.). Also fires ONCE on initial mount below via the same triggerBoot
  // path so the SSR-safe initial state ("crt", booting: false) doesn't
  // leak past hydration — the user never sees the deterministic default.
  useEffect(() => {
    triggerBoot();
    if (typeof window === "undefined" || !window.qvHost) return;
    return window.qvHost.onPetReveal(() => triggerBoot());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close routes through the Electron shell so we hide (cheap to bring
  // back — VRM already loaded) instead of destroying the window. Falls back
  // to a plain window.close() in a normal browser tab so dev sessions still
  // behave predictably.
  const closePet = () => {
    if (typeof window !== "undefined" && window.qvHost) {
      window.qvHost.hidePet().catch(() => { /* ignore */ });
    } else {
      try { window.close(); } catch { /* ignore */ }
    }
  };

  const hasHost = typeof window !== "undefined" && !!window.qvHost;

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
          without reshaping the character — the mount just re-centers it.
          `bootTick` is baked into the key so re-triggering boot restarts
          the CSS animation instead of no-oping on the same DOM node. */}
      <div className="qv-no-drag flex-1 relative flex items-center justify-center overflow-hidden">
        {booting && (
          <div
            key={`boot-${bootTick}`}
            className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
            aria-hidden
          >
            <BootOverlayLayers variant={bootVariant} />
          </div>
        )}
        <div
          key={`char-${bootTick}`}
          className={booting ? CHAR_CLASS_BY_VARIANT[bootVariant] : ""}
        >
          {target === "self" ? (
            <VrmAvatar
              blendshapeRef={blendshapeRef}
              poseRef={poseRef}
              size={260}
              vrmPath={selectedEntry.vrmPath}
              placeholderEmoji={selectedEntry.emoji}
              placeholderTint={selectedEntry.tint}
              mirror
              transparent
            />
          ) : (
            <PartnerPlaceholder />
          )}
        </div>
      </div>

      {/* Bottom-edge status text. Kept ultra-quiet so the pet reads as
          decoration when everything's fine. Only surfaces the cases the
          user might act on. */}
      <div className="qv-no-drag min-h-[16px] flex items-center justify-center text-[10px] text-white/50 select-none pb-1">
        {target === "self" && !hasHost && (
          <span className="text-yellow-500/70">仅 Electron 支持追踪</span>
        )}
        {target === "self" && hasHost && !connected && (
          <span>等待主窗口打开摄像头…</span>
        )}
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
