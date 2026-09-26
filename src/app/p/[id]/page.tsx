import type { Metadata } from "next";
import { ConsoleApp } from "@/components/console/ConsoleApp";

export const metadata: Metadata = {
  title: "控制台 · Livelyrics",
  robots: { index: false, follow: false },
};

/** Operator console: full information + controls; drives the projection window. */
export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // key: a different project gets a fresh controller (audio, channel, clock)
  return <ConsoleApp key={id} id={id} />;
}
