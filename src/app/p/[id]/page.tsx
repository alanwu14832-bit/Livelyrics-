import type { Metadata, Viewport } from "next";
import { cache, ViewTransition } from "react";
import { ConsoleApp, type ConsoleIntro } from "@/components/console/ConsoleApp";
import { getProject } from "@/lib/server/storage";

// The console is always dark (a pro app for dark venues), whatever the system appearance.
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

/**
 * Title and palette for the first paint: the loading state shows the song's thumbnail and title
 * under the same view-transition names as the library card, so they morph across the navigation.
 * The console itself still loads the full project through the API.
 */
const readIntro = cache(async (id: string): Promise<ConsoleIntro | null> => {
  try {
    const project = await getProject(id);
    if (!project) return null;
    return {
      title: project.meta.title || project.meta.fileName || "未命名歌曲",
      artist: project.meta.artist || "",
      palette: (project.plan?.keyVisual?.palette ?? []).map((p) => p.hex).filter((h): h is string => typeof h === "string").slice(0, 3),
    };
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const intro = await readIntro(id);
  return {
    title: intro ? `${intro.title}｜控制台` : "控制台｜Livelyrics",
    robots: { index: false, follow: false },
  };
}

/** Operator console: full information + controls; drives the projection window. */
export default async function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const intro = await readIntro(id);
  // data-theme="console" is rendered on the server, so every state (skeleton, not ready, not
  // found, the console itself) is dark from the first paint. The page slides in like an iOS
  // navigation push (and back out on 「‹ 作品庫」); untyped navigations do not animate.
  // key: a different project gets a fresh controller (audio, channel, clock)
  return (
    <ViewTransition enter={{ push: "push", pop: "pop", default: "none" }} exit={{ push: "push", pop: "pop", default: "none" }} default="none">
      <div data-theme="console" className="min-h-screen bg-bg text-label">
        <ConsoleApp key={id} id={id} intro={intro} />
      </div>
    </ViewTransition>
  );
}
