import type { Metadata, Viewport } from "next";
import { ConsoleApp } from "@/components/console/ConsoleApp";

export const metadata: Metadata = {
  title: "控制台 · Livelyrics",
  robots: { index: false, follow: false },
};

// The console is always dark (a pro app for dark venues), whatever the system appearance.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

/** Operator console: full information + controls; drives the projection window. */
export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // data-theme="console" is rendered on the server, so every state (skeleton, not ready, not
  // found, the console itself) is dark from the first paint.
  // key: a different project gets a fresh controller (audio, channel, clock)
  return (
    <div data-theme="console" className="min-h-screen bg-bg text-label">
      <ConsoleApp key={id} id={id} />
    </div>
  );
}
