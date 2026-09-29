import type { Metadata, Viewport } from "next";
import { ViewTransition, cache } from "react";
import { ShowLiveApp } from "@/components/show-live/ShowLiveApp";
import { getShow } from "@/lib/server/band-storage";
import { isValidShowId } from "@/lib/show";

// The show console is always dark, like the song console (a pro app for dark venues).
export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

const loadName = cache(async (id: string): Promise<string | undefined> => {
  try {
    if (!isValidShowId(id)) return undefined;
    return (await getShow(id))?.name;
  } catch {
    return undefined;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const name = await loadName((await params).id);
  return { title: name ? `${name}｜演出控制台` : "演出控制台｜Livelyrics", robots: { index: false, follow: false } };
}

/** 演出控制台: GO through the setlist, one projection window (/s/[id]/output) for the whole show. */
export default async function ShowLivePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = await loadName(id);
  // data-theme="console" on the server: dark from the first paint, in every state
  // key: another show gets a fresh controller (items, channel, preloads)
  return (
    <ViewTransition enter={{ push: "push", pop: "pop", default: "none" }} exit={{ push: "push", pop: "pop", default: "none" }} default="none">
      <div data-theme="console" className="min-h-screen bg-bg text-label">
        <ShowLiveApp key={id} id={id} initialName={name} />
      </div>
    </ViewTransition>
  );
}
