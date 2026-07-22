"use client";

/**
 * Client-side wrapper around <body>'s padding-bottom so the "tab bar
 * reserves space" 只在实际显示 tab 栏的路由生效.
 *
 * BottomTabBar 本身是 fixed 定位,靠 body 的 pb-[62px] 给内容让位.
 * 但 /room / /pet / /welcome 等 tab 栏隐藏的路由如果继承这条 padding,
 * <main className="min-h-screen"> 会让 body 变成 100vh+62px 出现滚动条.
 *
 * 逻辑镜像 BottomTabBar.HIDE_ON_PREFIXES.
 */

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useMemo } from "react";

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const NO_PAD_PREFIXES = [
  "/room",
  "/pet",
  "/login",
  "/welcome",
  "/audio-test",
  "/asr-test",
  "/sherpa-test",
];

function stripBase(path: string): string {
  if (!path) return "/";
  if (BASE_PATH && path.startsWith(BASE_PATH)) return path.slice(BASE_PATH.length) || "/";
  return path;
}

interface Props {
  children: ReactNode;
}

export default function TabBarPad({ children }: Props) {
  const pathname = usePathname();
  const path = useMemo(() => stripBase(pathname || "/"), [pathname]);
  const noPad = NO_PAD_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
  return <div className={noPad ? "" : "pb-[62px]"}>{children}</div>;
}
