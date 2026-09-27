import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { BandClient } from "@/components/band/BandClient";
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
  return { title: name ? `${name}｜樂團` : "樂團｜Livelyrics" };
}

/** 樂團: visual bible, shows (setlists), songs and the shared media library. */
export default async function BandPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const name = await loadName(id);
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <BandClient key={id} id={id} initialName={name} />
    </ViewTransition>
  );
}
