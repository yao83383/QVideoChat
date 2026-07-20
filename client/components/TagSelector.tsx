"use client";

import { useState, useEffect } from "react";
import * as api from "@/lib/api";

interface Tag {
  id: number;
  name: string;
  emoji: string;
  category: string;
}

interface Props {
  selected: string[];
  onChange: (tags: string[]) => void;
}

export default function TagSelector({ selected, onChange }: Props) {
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getAllTags()
      .then((tags) => { setAllTags(tags); setLoaded(true); })
      .catch(() => { setLoaded(true); });
  }, []);

  const toggle = (name: string) => {
    if (selected.includes(name)) {
      onChange(selected.filter((t) => t !== name));
    } else if (selected.length < 3) {
      onChange([...selected, name]);
    }
  };

  const categories = [...new Set(allTags.map((t) => t.category))];

  // Always show the selector button, even if tags haven't loaded yet
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-700 transition"
      >
        <span>
          {selected.length > 0
            ? `已选 ${selected.length} 个标签`
            : !loaded
            ? "加载标签中..."
            : allTags.length === 0
            ? "兴趣标签暂不可用"
            : "选择兴趣标签 (可选)"}
        </span>
        <span className="text-[10px]">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 w-full max-w-80">
          {categories.map((cat) => (
            <div key={cat}>
              <p className="text-[10px] text-slate-500 mb-1.5">{cat}</p>
              <div className="flex flex-wrap gap-1.5">
                {allTags
                  .filter((t) => t.category === cat)
                  .map((tag) => {
                    const active = selected.includes(tag.name);
                    return (
                      <button
                        key={tag.id}
                        onClick={() => toggle(tag.name)}
                        className={`rounded-full px-3 py-1 text-xs border transition ${
                          active
                            ? "bg-sky-500 text-white border-sky-500 shadow shadow-sky-500/30"
                            : "bg-slate-100 text-slate-700 border-slate-300 hover:border-sky-400"
                        }`}
                      >
                        {tag.emoji} {tag.name}
                      </button>
                    );
                  })}
              </div>
            </div>
          ))}
          {selected.length >= 3 && (
            <p className="text-[10px] text-amber-700">最多选择 3 个标签</p>
          )}
        </div>
      )}
    </div>
  );
}
