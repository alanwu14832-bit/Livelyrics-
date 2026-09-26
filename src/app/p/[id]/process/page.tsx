import type { Metadata } from "next";
import { ProcessClient } from "@/components/process/ProcessClient";
import { firstParam, parseRunParam, parseStepsParam } from "@/components/process/steps";

export const metadata: Metadata = {
  title: "設計總覽 — Livelyrics",
};

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
  return (
    <ProcessClient
      key={id}
      id={id}
      run={parseRunParam(query.run)}
      steps={parseStepsParam(query.steps)}
      instruction={firstParam(query.instruction)?.slice(0, 4000)}
    />
  );
}
