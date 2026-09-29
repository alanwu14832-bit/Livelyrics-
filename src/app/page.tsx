import { connection } from "next/server";
import { ViewTransition } from "react";
import { HomeClient } from "@/components/home/HomeClient";
import { PAGE_TRANSITION } from "@/components/home/transitions";
import { listProjects } from "@/lib/server/storage";
import { resolveStorageConfig } from "@/lib/server/store";
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

/** `?band=<id>` preselects the band for a new song (the band page's 「加入歌曲」). */
export default async function Home({ searchParams }: PageProps<"/">) {
  const { projects, now } = await loadLibrary();
  const band = (await searchParams).band;
  const initialBandId = typeof band === "string" && /^[a-z0-9-]{1,64}$/.test(band) ? band : undefined;
  // on Vercel without Blob / Postgres the first paint is the setup notice (no library requests)
  const storage = resolveStorageConfig();
  const setup = storage.mode === "unconfigured" ? { missing: storage.missing, blobStoreWithoutToken: storage.blobStoreWithoutToken } : null;
  return (
    <ViewTransition enter={PAGE_TRANSITION} exit={PAGE_TRANSITION} default="none">
      <HomeClient initialProjects={projects} serverNow={now} initialBandId={initialBandId} initialSetup={setup} />
    </ViewTransition>
  );
}
