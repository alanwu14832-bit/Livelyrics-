import type { Metadata } from "next";
import { ViewTransition, cache } from "react";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { ProcessClient, type ProcessHeaderInfo } from "@/components/process/ProcessClient";
import { firstParam, parseRunParam, parseStepsParam } from "@/components/process/steps";
import { getProject, isValidProjectId } from "@/lib/server/storage";

const HEX = /^#[0-9a-f]{6}$/i;

/** One read per request for both the title and the header info; load errors are the page's to report. */
const loadHeader = cache(async (id: string): Promise<ProcessHeaderInfo | null> => {
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
  return { title: song ? `${song}｜設計總覽` : "設計總覽｜Livelyrics" };
}

/**
 * Runs / observes the processing pipeline and shows the resulting key visual.
 * Query: ?run=1 [&steps=design|research,design] [&instruction=...] (see components/process/steps.ts).
 */
export default async function ProcessPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const initial = await loadHeader(id);
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <ProcessClient
        key={id}
        id={id}
        run={parseRunParam(query.run)}
        steps={parseStepsParam(query.steps)}
        instruction={firstParam(query.instruction)?.slice(0, 4000)}
        initial={initial}
      />
    </ViewTransition>
  );
}
