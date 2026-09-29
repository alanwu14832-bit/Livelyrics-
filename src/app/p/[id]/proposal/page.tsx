import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { ProposalClient } from "@/components/proposal/ProposalClient";
import { getProject, isValidProjectId } from "@/lib/server/storage";

const loadTitle = cache(async (id: string): Promise<string> => {
  try {
    if (!isValidProjectId(id)) return "";
    const p = await getProject(id);
    return p ? p.meta.title || p.meta.fileName || "" : "";
  } catch {
    return "";
  }
});

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const song = await loadTitle(id);
  return { title: song ? `${song}｜一頁提案` : "一頁提案｜Livelyrics" };
}

/** 一頁提案: the band sign-off sheet of a song's design directions, print-optimised (A4 landscape). */
export default async function ProposalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <ProposalClient key={id} id={id} />
    </ViewTransition>
  );
}
