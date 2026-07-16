import type { Metadata } from "next";
import "./globals.css";
import DesktopTitleBar from "@/components/DesktopTitleBar";

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
        {children}
      </body>
    </html>
  );
}
