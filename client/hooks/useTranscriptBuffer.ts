"use client";

/**
 * Rolling transcript buffer —— 举报 5min transcript 的数据源.
 *
 * 通话开始后 ASR 常跑,每个 final 结果都进这里,带 speakerUserId +
 * text + timestamp.用户点举报时,ReportModal 拿到 snapshot() 后
 * 打包和 reason 一起 POST 到 /api/reports/report.
 *
 * 设计约束:
 *
 * - 只写 **isFinal** 的段.interim 结果不断被同一句话的下一版覆盖,
 *   存进 buffer 只会产生 N 份不完整的重复,没审核价值.
 *
 * - 时间窗默认 5 分钟(WINDOW_MS).每次 append 时把旧于窗口的裁掉.
 *   append 是 O(n) —— n 只可能是"5 分钟内说的完整句数",大概 20-100 条,
 *   不需要真环形队列.
 *
 * - state 用 ref 存,不上 useState:buffer 每几秒改一次没必要触发
 *   rerender.snapshot() 由 caller 主动调.
 *
 * - 同一个 hook 实例既接自己也接对方(通过 speakerUserId 区分),
 *   不要为每一方各建一个 buffer —— 举报要的是双方合并按时序.
 */

import { useCallback, useRef } from "react";

export interface TranscriptEntry {
  /** userId(自己或对方). server 端根据 fromUserId/targetUserId 判定归属. */
  speakerUserId: string;
  /** ASR 出的完整一句原文.译文不进 buffer —— 举报审核的是"说了什么",
   *  译文只是产品功能,不作证据. */
  text: string;
  /** Unix ms.用于时间窗裁剪和展示顺序. */
  ts: number;
}

const WINDOW_MS = 5 * 60_000;

export function useTranscriptBuffer(windowMs: number = WINDOW_MS) {
  // 双 ref:一份写入源(append 里 mutate),一份用来给 snapshot 复制.
  // 单份也行,只是 snapshot 会 alloc 一次;因为 snapshot 只在举报时
  // 调,alloc 开销可忽略.
  const bufferRef = useRef<TranscriptEntry[]>([]);

  const append = useCallback((entry: TranscriptEntry, isFinal: boolean) => {
    if (!isFinal) return;                       // interim 不进
    if (!entry.text || !entry.text.trim()) return;
    const now = Date.now();
    const cutoff = now - windowMs;
    const buf = bufferRef.current;
    // 裁掉过期 —— 只在 buffer 头部;通话早期都是新的这条判断很快 exit.
    while (buf.length > 0 && buf[0].ts < cutoff) buf.shift();
    buf.push(entry);
  }, [windowMs]);

  /** 拿当前 5min 内的所有条目(拷贝副本,防被后续 mutate 影响). */
  const snapshot = useCallback((): TranscriptEntry[] => {
    const cutoff = Date.now() - windowMs;
    return bufferRef.current.filter((e) => e.ts >= cutoff).map((e) => ({ ...e }));
  }, [windowMs]);

  /** 换 room / 挂断时清空,避免上一轮通话被误算作证据. */
  const clear = useCallback(() => {
    bufferRef.current = [];
  }, []);

  return { append, snapshot, clear };
}
