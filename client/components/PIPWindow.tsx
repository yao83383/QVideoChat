"use client";

/**
 * PIPWindow —— 通话页悬浮小窗容器.
 *
 * 微信通话交互约定:
 *   - 默认展示:大 = 对方,小 = 自己
 *   - 单击小窗 → 主从互换(通过 onSwap 回调,swap 由父组件决定含义)
 *   - 长按 500ms → 淡出隐藏;抬手立刻恢复
 *   - 拖拽 → 自动吸附到最近的四角
 *
 * 组件只管"容器 + 交互",不管里面装什么 —— 通过 children 传入.
 * 这样 self / peer 两个视图可以互换主从但复用同一个小窗壳子.
 *
 * 镜像 toggle 之类跟"里面渲染的是谁"绑定的开关,让父组件通过 children
 * 自己塞,PIPWindow 不参与.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";

type Corner = "tl" | "tr" | "bl" | "br";

interface Props {
  children: ReactNode;
  /** 初始角落. 默认右下. */
  initialCorner?: Corner;
  /** 单击(< 200ms + 位移 < 5px)时触发. 长按/拖拽不触发. */
  onSwap?: () => void;
  /** 小窗宽度. 默认 96(24 * 4). */
  width?: number;
  /** 小窗高度. 默认 128. */
  height?: number;
  /** 距离屏幕边缘的 padding.默认 16. */
  edgePadding?: number;
  /** 距离底部工具栏的额外偏移,避免被 CallToolbar 挡住. */
  bottomInset?: number;
}

// 长按判定阈值.超过此时长仍在按住 → 隐藏 tile.
const HOLD_HIDE_MS = 500;
// 单击判定的最大移动像素.超过认为是拖动,不触发 swap.
const TAP_MAX_MOVE_PX = 5;

export default function PIPWindow({
  children,
  initialCorner = "br",
  onSwap,
  width = 96,
  height = 128,
  edgePadding = 16,
  bottomInset = 88,
}: Props) {
  const [corner, setCorner] = useState<Corner>(initialCorner);
  const [dragOffset, setDragOffset] = useState<{ dx: number; dy: number } | null>(null);
  const [hidden, setHidden] = useState(false);

  // 交互状态用 ref,pointer 移动过程中不 rerender,只有拖拽结束才 setState.
  const pointerStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const pointerCurrentRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const cornerToPosition = (c: Corner): { top?: number; bottom?: number; left?: number; right?: number } => {
    switch (c) {
      case "tl": return { top: edgePadding, left: edgePadding };
      case "tr": return { top: edgePadding, right: edgePadding };
      case "bl": return { bottom: edgePadding + bottomInset, left: edgePadding };
      case "br":
      default:  return { bottom: edgePadding + bottomInset, right: edgePadding };
    }
  };

  const nearestCorner = (x: number, y: number): Corner => {
    if (typeof window === "undefined") return "br";
    const halfW = window.innerWidth / 2;
    const halfH = window.innerHeight / 2;
    const left = x < halfW;
    const top = y < halfH;
    if (top && left) return "tl";
    if (top && !left) return "tr";
    if (!top && left) return "bl";
    return "br";
  };

  const onPointerDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointerStartRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
    pointerCurrentRef.current = { x: e.clientX, y: e.clientY };
    isDraggingRef.current = false;
    clearHoldTimer();
    holdTimerRef.current = setTimeout(() => {
      // 长按到点 → 隐藏.
      const start = pointerStartRef.current;
      const cur = pointerCurrentRef.current;
      if (!start || !cur) return;
      const moved = Math.abs(cur.x - start.x) + Math.abs(cur.y - start.y);
      if (moved < TAP_MAX_MOVE_PX) setHidden(true);
    }, HOLD_HIDE_MS);
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const start = pointerStartRef.current;
    if (!start) return;
    pointerCurrentRef.current = { x: e.clientX, y: e.clientY };
    const moved = Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y);
    if (moved > TAP_MAX_MOVE_PX) {
      // 一旦超过点击容差就进入拖拽 —— 取消长按 timer.
      if (!isDraggingRef.current) {
        isDraggingRef.current = true;
        clearHoldTimer();
      }
      setDragOffset({ dx: e.clientX - start.x, dy: e.clientY - start.y });
    }
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const start = pointerStartRef.current;
    pointerStartRef.current = null;
    clearHoldTimer();
    // 抬手后恢复(如果长按隐藏了).
    if (hidden) setHidden(false);

    if (!start) return;
    const dt = Date.now() - start.t;
    const moved = Math.abs(e.clientX - start.x) + Math.abs(e.clientY - start.y);

    if (isDraggingRef.current) {
      // 拖拽结束 → 吸附.
      setCorner(nearestCorner(e.clientX, e.clientY));
      setDragOffset(null);
      isDraggingRef.current = false;
      return;
    }
    // 单击(短时 + 小位移)→ swap.
    if (dt < HOLD_HIDE_MS && moved < TAP_MAX_MOVE_PX) {
      onSwap?.();
    }
  };

  const onPointerCancel = () => {
    pointerStartRef.current = null;
    isDraggingRef.current = false;
    clearHoldTimer();
    setDragOffset(null);
    if (hidden) setHidden(false);
  };

  useEffect(() => () => clearHoldTimer(), [clearHoldTimer]);

  const pos = cornerToPosition(corner);
  const style: React.CSSProperties = {
    position: "fixed",
    width,
    height,
    zIndex: 30,
    touchAction: "none",
    transform: dragOffset ? `translate(${dragOffset.dx}px, ${dragOffset.dy}px)` : undefined,
    transition: dragOffset ? "none" : "transform 0.2s ease, opacity 0.15s ease",
    opacity: hidden ? 0 : 1,
    pointerEvents: hidden ? "none" : "auto",
    ...pos,
  };

  return (
    <div
      className="rounded-2xl overflow-hidden shadow-lg shadow-slate-900/40 ring-1 ring-white/10 bg-black cursor-pointer"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      role="button"
      aria-label="切换主从视图"
    >
      {children}
    </div>
  );
}
