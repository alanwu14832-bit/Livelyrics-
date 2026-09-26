import type { Metadata, Viewport } from "next";
import { fontVariables } from "@/lib/fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Livelyrics｜舞台歌詞視覺",
  description: "上傳歌曲，AI 舞台視覺設計師自動研究並設計主視覺、歌詞與動畫，現場即時操控投影。",
};

// Pages follow the system appearance (light by default, like apple.com); the console and the
// stage pages declare their own dark scheme.
export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f5f7" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className={`${fontVariables} h-full antialiased`}>
      <body className="min-h-full bg-bg text-label">{children}</body>
    </html>
  );
}
