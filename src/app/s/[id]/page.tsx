import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { ShowClient } from "@/components/show/ShowClient";
import { isValidShowId } from "@/lib/show";
import { getShow } from "@/lib/server/band-storage";

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
  return { title: name ? `${name}｜演出` : "演出｜Livelyrics" };
}

/** 演出: the setlist editor (songs, walk-in / interlude / standby / walk-out looks, the show arc). */
export default async function ShowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = await loadName(id);
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <ShowClient key={id} id={id} initialName={name} />
    </ViewTransition>
  );
}
