import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { BibleEditor } from "@/components/band/BibleEditor";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { isValidBandId } from "@/lib/band";
import { getBand } from "@/lib/server/band-storage";

const loadName = cache(async (id: string): Promise<string | undefined> => {
  try {
    if (!isValidBandId(id)) return undefined;
    return (await getBand(id))?.name;
  } catch {
    return undefined;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const name = await loadName((await params).id);
  return { title: name ? `${name}｜視覺聖經` : "視覺聖經｜Livelyrics" };
}

/** The band's visual bible editor. */
export default async function BiblePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = await loadName(id);
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <BibleEditor key={id} id={id} initialName={name} />
    </ViewTransition>
  );
}
