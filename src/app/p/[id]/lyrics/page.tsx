import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { LyricsEditorClient, type EditorHeaderInfo } from "@/components/lyrics-editor/LyricsEditorClient";
import { getProject, isValidProjectId } from "@/lib/server/storage";

const HEX = /^#[0-9a-f]{6}$/i;

/** One read per request for both the title and the header (thumbnail + title in the first paint, so
 *  the library card and the design overview header morph into it); load errors are the page's. */
const loadHeader = cache(async (id: string): Promise<EditorHeaderInfo | null> => {
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
  return { title: song ? `${song}｜歌詞編輯` : "歌詞編輯｜Livelyrics" };
}

/** Lyrics editor: timing table, import/export, LRCLIB, tap-sync, auto-distribute. */
export default async function LyricsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const initial = await loadHeader(id);
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <LyricsEditorClient key={id} id={id} initial={initial} />
    </ViewTransition>
  );
}
