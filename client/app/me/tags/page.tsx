"use client";

/**
 * /me/tags —— 编辑兴趣标签.
 *
 * 复用 TagSelector,persist 走同一个 localStorage key (qv_pendingTags)
 * 让首页 chip 和匹配器都能读到同一份。
 */

import { useEffect, useState } from "react";
import MeSubShell from "@/components/MeSubShell";
import TagSelector from "@/components/TagSelector";

export default function MeTagsPage() {
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("qv_pendingTags");
      const parsed = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) setTags(parsed);
    } catch { /* ignore */ }
  }, []);

  const handleChange = (next: string[]) => {
    setTags(next);
    try {
      localStorage.setItem("qv_pendingTags", JSON.stringify(next));
    } catch { /* ignore */ }
  };

  return (
    <MeSubShell
      title="兴趣标签"
      subtitle="匹配算法根据标签重合度优先撮合。不选也能匹配,但更随机。"
    >
      <div className="rounded-2xl bg-white border border-slate-200 p-4">
        <TagSelector selected={tags} onChange={handleChange} />
      </div>
    </MeSubShell>
  );
}
