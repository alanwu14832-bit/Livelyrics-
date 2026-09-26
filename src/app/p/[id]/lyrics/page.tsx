import type { Metadata } from "next";
import { LyricsEditorClient } from "@/components/lyrics-editor/LyricsEditorClient";
import { getProject, isValidProjectId } from "@/lib/server/storage";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  let song = "";
  try {
    if (isValidProjectId(id)) song = (await getProject(id))?.meta.title ?? "";
  } catch {
    /* the page itself reports load errors */
  }
  return { title: song ? `${song} · 歌詞編輯 — Livelyrics` : "歌詞編輯 — Livelyrics" };
}

/** Lyrics editor: timing table, import/export, LRCLIB, tap-sync, auto-distribute. */
export default async function LyricsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LyricsEditorClient key={id} id={id} />;
}
