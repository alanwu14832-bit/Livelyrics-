import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { TypeEditorClient, type TypeEditorHeaderInfo } from "@/components/type-editor/TypeEditorClient";
import { getProject, isValidProjectId } from "@/lib/server/storage";

const HEX = /^#[0-9a-f]{6}$/i;

/** One read per request for both the title and the header (thumbnail + title in the first paint). */
const loadHeader = cache(async (id: string): Promise<TypeEditorHeaderInfo | null> => {
  try {
    if (!isValidProjectId(id)) return null;
    const p = await getProject(id);
    if (!p) return null;
    const palette = (p.plan?.keyVisual.palette ?? []).map((c) => c.hex).filter((c) => typeof c === "string" && HEX.test(c)).slice(0, 4);
    return { title: p.meta.title || p.meta.fileName || "", artist: p.meta.artist || "", palette };
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const song = (await loadHeader(id))?.title ?? "";
  return { title: song ? `${song}｜排版` : "排版｜Livelyrics" };
}

/** 排版 (字體藝術): the song's typographic voice and every line's composition, desktop and phone. */
export default async function TypePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initial = await loadHeader(id);
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <TypeEditorClient key={id} id={id} initial={initial} />
    </ViewTransition>
  );
}
