import type { Metadata } from "next";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Livelyrics — 舞台歌詞視覺",
  description: "上傳歌曲，AI 舞台視覺設計師自動研究並設計主視覺、歌詞與動畫，現場即時操控投影。",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full bg-bg text-fg">{children}</body>
    </html>
  );
}
