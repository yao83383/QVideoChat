import type { Metadata } from "next";
import "./globals.css";
import DesktopTitleBar from "@/components/DesktopTitleBar";
import BottomTabBar from "@/components/BottomTabBar";
import TabBarPad from "@/components/TabBarPad";
import { SocketProvider } from "@/contexts/SocketContext";

export const metadata: Metadata = {
  title: "QVideoChat",
  description: "视频通话 - Q版虚拟形象",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      {/* body 只保证最小高度,padding-bottom 交给 TabBarPad 判断 —— 通话页
          等 tab 隐藏的路由不需要这条 padding,否则 min-h-screen 加上会
          让 body 变成 100vh+62px 出现滚动条. */}
      <body className="min-h-screen">
        <DesktopTitleBar />
        <SocketProvider>
          <TabBarPad>{children}</TabBarPad>
          <BottomTabBar />
        </SocketProvider>
      </body>
    </html>
  );
}
