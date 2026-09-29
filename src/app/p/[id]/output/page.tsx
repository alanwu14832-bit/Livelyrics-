import type { Metadata, Viewport } from "next";
import { OutputClient } from "./OutputClient";

export const metadata: Metadata = {
  title: "投影輸出 — Livelyrics",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

/** Projection window: animation + lyrics only, driven by the console over a BroadcastChannel. */
export default async function OutputPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OutputClient id={id} />;
}
