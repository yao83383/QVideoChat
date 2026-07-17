"use client";

interface Props {
  /** Dismissed without matching. Parent keeps the acknowledgement flag unset
   *  so this fires again next time (unless the user opens the camera). */
  onCancel: () => void;
  /** User chose to match anyway. Parent should persist the ack flag AND then
   *  kick off the same handleMatch flow the primary CTA would run. */
  onProceed: () => void;
}

/** Shown when the user taps "开始匹配" without granting camera permission (or
 *  never turning it on). Two responsibilities:
 *    1. Explain the consequence of matching without a camera — the peer sees
 *       an idle rest-pose avatar with no facial motion. Users have to opt in
 *       consciously, not sleepwalk into a lower-quality experience.
 *    2. Reinforce the community tone (be kind, be honest) in the exact moment
 *       the user is deciding to interact with strangers. Content-heavy CTA
 *       moments are the highest-attention surface we have for norm-setting.
 *
 *  The ack flag lives in sessionStorage on the parent so it re-fires next
 *  session — one gentle reminder per browsing session, not per click. */
export default function NoCameraMatchNotice({ onCancel, onProceed }: Props) {
  return (
    <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="w-full max-w-md rounded-3xl bg-neutral-900 border border-white/10 p-6 flex flex-col gap-5 shadow-2xl">
        <div className="text-center">
          <div className="text-4xl mb-2">📷</div>
          <h2 className="text-xl font-bold">要不要先打开摄像头?</h2>
          <p className="text-neutral-400 text-xs mt-1">
            没有摄像头也能匹配,但对方只能看到静止的化身
          </p>
        </div>

        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">🎭</span>
            <div>
              <p className="font-medium text-neutral-100">化身不会跟着你动</p>
              <p className="text-neutral-500 text-xs mt-0.5">
                对方看到的化身没有表情、不点头,像一张静态图片
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-white/[0.03] border border-white/10 p-3">
            <span className="text-lg shrink-0">💬</span>
            <div>
              <p className="font-medium text-neutral-100">仍然可以语音聊天</p>
              <p className="text-neutral-500 text-xs mt-0.5">
                麦克风还是要开的,不然对方听不到你的声音
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-xl bg-gradient-to-br from-sky-500/10 to-cyan-500/10 border border-sky-500/25 p-3">
            <span className="text-lg shrink-0">💚</span>
            <div>
              <p className="font-medium text-neutral-100">请友善交友、诚信待人</p>
              <p className="text-neutral-400 text-xs mt-0.5">
                认真对待每一次相遇,一起维护温暖的社区氛围
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onProceed}
            className="w-full rounded-2xl bg-gradient-to-r from-sky-400 via-cyan-400 to-emerald-500 hover:from-sky-500 hover:via-cyan-500 hover:to-emerald-600 text-white px-6 py-3 text-sm font-semibold shadow-lg shadow-emerald-500/30 transition"
          >
            知道了,继续匹配
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition py-2"
          >
            我再想想 / 先打开摄像头
          </button>
        </div>
      </div>
    </div>
  );
}
