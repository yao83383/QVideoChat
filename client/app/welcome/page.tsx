"use client";

/**
 * /welcome —— 首次访问的一次性入口.
 *
 * 承接原本挂在 / 上的两个"必须先看的"模态:
 *   1. CommunityGuidelinesModal —— 社区准则同意勾选
 *   2. OnboardingWizard —— 三步:兴趣标签 → 语言 → 打开摄像头
 *
 * 之所以变成独立 route:模态本质是"打断"式交互,首次上来的用户看到
 * 首页有匹配按钮但被两层模态盖住,视觉上很挤;抽出来后每一步都占
 * 整屏,注意力集中.完成后自动跳 /.
 *
 * 二次访问的用户 / 已经走过引导的用户不会来这里(首页的 useEffect
 * 里判断 gate + qv_onboarded 才 replace 到这).直接输 URL 强制访问
 * 也可以 —— 拿来当"重新看一遍"用.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import CommunityGuidelinesModal, { needsCommunityGate } from "@/components/CommunityGuidelinesModal";
import OnboardingWizard from "@/components/OnboardingWizard";
import { useFaceMesh } from "@/hooks/useFaceMesh";

export default function WelcomePage() {
  const router = useRouter();
  const { start } = useFaceMesh();

  // gate 状态:"gate" / "onboarding" / "done"
  const [stage, setStage] = useState<"gate" | "onboarding" | "done">("gate");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // 已经走过 gate 就直接跳到 onboarding 阶段.已经全部走完就出去.
    const gate = needsCommunityGate();
    const onboarded = localStorage.getItem("qv_onboarded") === "1";
    if (!gate && onboarded) {
      router.replace("/");
      return;
    }
    if (!gate) setStage("onboarding");
    try {
      const raw = localStorage.getItem("qv_pendingTags");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setSelectedTags(parsed);
    } catch { /* ignore */ }
  }, [router]);

  const completeOnboarding = () => {
    try {
      localStorage.setItem("qv_onboarded", "1");
      localStorage.setItem("qv_onboarded_at", String(Date.now()));
    } catch { /* ignore */ }
    setStage("done");
    router.replace("/");
  };

  const tagsChange = (next: string[]) => {
    setSelectedTags(next);
    try { localStorage.setItem("qv_pendingTags", JSON.stringify(next)); } catch { /* ignore */ }
  };

  return (
    <main className="min-h-screen">
      {stage === "gate" && (
        <CommunityGuidelinesModal onAccept={() => setStage("onboarding")} />
      )}
      {stage === "onboarding" && (
        <OnboardingWizard
          show={true}
          onComplete={completeOnboarding}
          onOpenCamera={start}
          onGoToAvatars={() => {
            completeOnboarding();
            router.push("/avatars");
          }}
          selectedTags={selectedTags}
          onTagsChange={tagsChange}
        />
      )}
    </main>
  );
}
