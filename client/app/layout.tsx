import type { Metadata } from "next";
import "./globals.css";
import DesktopTitleBar from "@/components/DesktopTitleBar";
import BottomTabBar from "@/components/BottomTabBar";
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
      {/* 全局给底部留 tab 栏高度 —— BottomTabBar 自己 hidden 的路由(通话页等)
          也吃这条 padding,但空 62px 不影响布局,还省得每个 page 各自处理。 */}
      <body className="min-h-screen pb-[62px]">
        {/* Only paints inside Electron shell + outside /pet route. In a
            plain browser tab this renders nothing and body's padding-top
            stays whatever CSS said. */}
        <DesktopTitleBar />
        {/* App-wide socket: one connection for the whole app so friends see
            each other's presence regardless of what page they're on. See
            contexts/SocketContext.tsx for the rationale. */}
        <SocketProvider>
          {children}
          <BottomTabBar />
        </SocketProvider>
      </body>
    </html>
  );
}
