import { connection } from "next/server";
import { ViewTransition } from "react";
import { HomeClient } from "@/components/home/HomeClient";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { listProjects } from "@/lib/server/storage";
import type { ProjectSummary } from "@/lib/types";

/**
 * Home: server status, upload → analysis → new project, and the project library.
 * The library is read on the server, so the cards are in the first paint (no skeleton, and the
 * 「‹ 作品庫」 pop transition finds the card art to morph back into); the client refreshes it.
 */
async function loadLibrary(): Promise<{ projects: ProjectSummary[] | null; now: number }> {
  await connection(); // the list is per request, never prerendered
  try {
    return { projects: await listProjects(), now: Date.now() };
  } catch {
    return { projects: null, now: Date.now() }; // the client load reports the error
  }
}

export default async function Home() {
  const { projects, now } = await loadLibrary();
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <HomeClient initialProjects={projects} serverNow={now} />
    </ViewTransition>
  );
}
