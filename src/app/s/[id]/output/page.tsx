import type { Metadata, Viewport } from "next";
import { cache } from "react";
import { ProjectionOutput } from "@/components/stage/ProjectionOutput";
import { getShow } from "@/lib/server/band-storage";
import { isValidShowId } from "@/lib/show";
import { showChannelName } from "@/lib/stage/protocol";

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
  return { title: name ? `${name}｜投影輸出` : "投影輸出｜Livelyrics", robots: { index: false, follow: false } };
}

export const viewport: Viewport = {
  themeColor: "#000000",
  colorScheme: "dark",
};

/**
 * The show's projection window (one for the whole show): animation + lyrics only, driven by the
 * show console (/s/[id]/live) over the show channel, item after item.
 */
export default async function ShowOutputPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = await loadName(id);
  return <ProjectionOutput channel={showChannelName(id)} title={name} />;
}
