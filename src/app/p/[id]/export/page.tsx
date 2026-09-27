import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { ExportClient, type ExportHeaderInfo } from "@/components/export/ExportClient";
import { getProject, isValidProjectId } from "@/lib/server/storage";

const HEX = /^#[0-9a-f]{6}$/i;

/** One read per request for both the title and the header (thumbnail + title in the first paint). */
const loadHeader = cache(async (id: string): Promise<ExportHeaderInfo | null> => {
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
  return { title: song ? `${song}｜匯出影片` : "匯出影片｜Livelyrics" };
}

/**
 * Pre-rendered video export for festival media servers. Query: ?t=<seconds> puts the 單格預覽 at
 * that song time (the console passes its playhead).
 */
export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const rawT = Array.isArray(query.t) ? query.t[0] : query.t;
  const t = rawT != null && Number.isFinite(Number(rawT)) ? Math.max(0, Number(rawT)) : null;
  const initial = await loadHeader(id);
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <ExportClient key={id} id={id} initial={initial} initialTime={t} />
    </ViewTransition>
  );
}
