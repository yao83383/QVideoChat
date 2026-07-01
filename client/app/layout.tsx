import type { Metadata } from "next";
import "./globals.css";

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
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
