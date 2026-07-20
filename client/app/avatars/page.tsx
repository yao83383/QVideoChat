"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import AvatarCard from "@/components/AvatarCard";
import VrmAvatar from "@/components/VrmAvatar";
import { useFaceMesh } from "@/hooks/useFaceMesh";
import { useSelectedAvatar } from "@/hooks/useSelectedAvatar";
import {
  AVATARS,
  avatarsByGender,
  bumpAvatarClick,
  type AvatarEntry,
} from "@/lib/avatars";

/** Avatar picker. Renders the catalog in three groups (unisex / female / male)
 *  and offers a full 3D preview in a click-through modal. Committing from the
 *  modal writes the new avatar id via `useSelectedAvatar`, which any mounted
 *  VrmAvatar downstream (Home page hero, room preview) picks up on the next
 *  render.
 *
 *  No wishlist / lock UI anymore — with real VRMs shipping, every entry is
 *  free-to-use. The `qv_avatar_click_*` and `qv_avatar_selected_*` counters
 *  stay so we still learn what people gravitate to. */
export default function AvatarsPage() {
  const router = useRouter();
  const { selectedId, setSelected, selectedEntry } = useSelectedAvatar();
  const [preview, setPreview] = useState<AvatarEntry | null>(null);

  const female = avatarsByGender("female");
  const male = avatarsByGender("male");
  const unisex = avatarsByGender("unisex");

  const handleCardClick = (entry: AvatarEntry) => {
    bumpAvatarClick(entry.id);
    setPreview(entry);
  };

  const handleCommit = () => {
    if (!preview) return;
    setSelected(preview.id);
    setPreview(null);
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center px-4 pt-6 pb-16 gap-8">
      {/* Nav */}
      <div className="w-full max-w-3xl flex items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="text-sm text-slate-500 hover:text-slate-900 transition"
        >
          ← 返回
        </button>
        <span className="text-xs text-slate-500">我的化身</span>
      </div>

      {/* Header */}
      <div className="w-full max-w-3xl text-center">
        <p className="text-sky-600 text-xs font-bold tracking-widest uppercase mb-2">Avatars</p>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-3 text-slate-900">挑一个化身</h1>
        <p className="text-slate-600 text-sm max-w-xl mx-auto">
          点开预览,选中的化身会在通话中代表你出镜。
        </p>
      </div>

      {/* Current-avatar summary card. Docked directly under the header so
          arriving from the home "换一换 →" pill the user immediately sees which
          one they're currently wearing without scrolling to hunt for the green
          "使用中" badge on the section grids below.
          在浅底页面里独用白卡 + sky 边框,不套 entry.tint (tint 是各化身的个性色板,
          留给下面网格卡片和 PreviewModal 展示;此摘要卡要和页面基调协调)。 */}
      <div className="w-full max-w-3xl">
        <div className="flex items-center gap-4 rounded-2xl bg-white border border-sky-200 shadow-sm shadow-sky-500/10 p-4">
          <div className="qv-dark-surface w-16 h-16 rounded-2xl flex items-center justify-center border border-slate-900/10 shrink-0">
            <span className="text-4xl select-none" aria-hidden>{selectedEntry.emoji}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-emerald-600 tracking-wider uppercase font-bold mb-0.5">使用中</p>
            <p className="text-sm sm:text-base font-semibold text-slate-900 truncate">{selectedEntry.name}</p>
            <p className="text-xs text-slate-600 line-clamp-1">{selectedEntry.tagline}</p>
          </div>
        </div>
      </div>

      {unisex.length > 0 && (
        <Section title="通用" hint={`${unisex.length} 个`}>
          {unisex.map((a) => (
            <AvatarCard
              key={a.id}
              entry={a}
              selected={selectedId === a.id}
              onClick={() => handleCardClick(a)}
            />
          ))}
        </Section>
      )}

      {female.length > 0 && (
        <Section title="女生" hint={`${female.length} 个`}>
          {female.map((a) => (
            <AvatarCard
              key={a.id}
              entry={a}
              selected={selectedId === a.id}
              onClick={() => handleCardClick(a)}
            />
          ))}
        </Section>
      )}

      {male.length > 0 && (
        <Section title="男生" hint={`${male.length} 个`}>
          {male.map((a) => (
            <AvatarCard
              key={a.id}
              entry={a}
              selected={selectedId === a.id}
              onClick={() => handleCardClick(a)}
            />
          ))}
        </Section>
      )}

      {preview && (
        <PreviewModal
          entry={preview}
          isCurrent={preview.id === selectedId}
          onCommit={handleCommit}
          onDismiss={() => setPreview(null)}
        />
      )}
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="w-full max-w-3xl">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
        <span className="text-xs text-slate-500">{hint}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {children}
      </div>
    </section>
  );
}

interface PreviewProps {
  entry: AvatarEntry;
  isCurrent: boolean;
  onCommit: () => void;
  onDismiss: () => void;
}

/** Full-screen modal with a live VrmAvatar rendering the previewed entry.
 *  Only ONE VrmAvatar mounts at a time (this one), so the WebGL cost stays
 *  proportional to selection intent rather than catalog size. */
function PreviewModal({ entry, isCurrent, onCommit, onDismiss }: PreviewProps) {
  const { videoRef, blendshapeRef, poseRef, isLoaded, isCameraOn, start, stop, faceFound, step, error } = useFaceMesh();

  // Drive the preview with the user's real face for the modal's lifetime.
  // useFaceMesh is per-instance (this modal owns its own MediaStream + tracker
  // state), so releasing on unmount can't disturb any camera the Home page
  // has going through a different useFaceMesh mount. Prior code left the
  // stream open here "in case it's shared" — it wasn't, so the browser tab's
  // camera-in-use indicator would stay lit after closing, which reads as a
  // privacy problem even when it isn't.
  useEffect(() => {
    start();
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silence unused-ref warning without changing the destructuring shape above.
  void videoRef;
  void isCameraOn;

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onDismiss(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onDismiss]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4"
      onClick={onDismiss}
    >
      {/* PreviewModal 内部保留深底作为化身"聚光灯" —— VRM 3D 预览在深底才有边界感,
          text-white 在此上下文继续有效。qv-dark-surface 显式标记这个作用域。 */}
      <div
        className={`qv-dark-surface relative w-full max-w-md rounded-3xl bg-gradient-to-br ${entry.tint} border border-white/10 backdrop-blur-md p-5 flex flex-col items-center gap-4 shadow-2xl shadow-slate-900/40`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-white">{entry.name}</p>
            <p className="text-xs text-white/60 mt-0.5">{entry.tagline}</p>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition"
          >
            ×
          </button>
        </div>

        {/* Live 3D preview */}
        <div className="w-full flex justify-center">
          <VrmAvatar
            blendshapeRef={blendshapeRef}
            poseRef={poseRef}
            vrmPath={entry.vrmPath}
            size={320}
            placeholderEmoji={entry.emoji}
            placeholderTint={entry.tint}
            mirror
          />
        </div>

        <p className="text-[10px] text-white/50 text-center min-h-[14px]">
          {error && <span className="text-rose-300">{error}</span>}
          {!error && step && !isLoaded && `加载中: ${step}`}
          {!error && isLoaded && !faceFound && "追踪就绪 · 未检测到人脸"}
          {!error && faceFound && "追踪中 · 试试笑一下"}
        </p>

        <div className="w-full flex flex-col gap-2">
          <button
            type="button"
            onClick={onCommit}
            disabled={isCurrent}
            className={`w-full rounded-2xl px-6 py-3 text-sm font-semibold transition ${
              isCurrent
                ? "bg-white/10 border border-white/10 text-white/50 cursor-default"
                : "bg-gradient-to-r from-sky-400 via-cyan-400 to-amber-400 hover:from-sky-500 hover:via-cyan-500 hover:to-amber-500 text-white shadow-lg shadow-amber-500/30"
            }`}
          >
            {isCurrent ? "当前化身" : "选为我的化身"}
          </button>
        </div>
      </div>
    </div>
  );
}
