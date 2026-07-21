import type { Metadata } from "next";
import "./globals.css";
import DesktopTitleBar from "@/components/DesktopTitleBar";
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
      <body className="min-h-screen">
        {/* Only paints inside Electron shell + outside /pet route. In a
            plain browser tab this renders nothing and body's padding-top
            stays whatever CSS said. */}
        <DesktopTitleBar />
        {/* App-wide socket: one connection for the whole app so friends see
            each other's presence regardless of what page they're on. See
            contexts/SocketContext.tsx for the rationale. */}
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}
