import { bandProjects, getBand, updateBand } from "@/lib/server/band-storage";
import { generateBible } from "@/lib/server/designer";
import { handle, HttpError, json, requireBandId } from "@/lib/server/http";
import type { AudioAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Claude may think for a while. 300 s is the Vercel Hobby ceiling; a larger value fails the deploy.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

function meanEnergy(a: AudioAnalysis | null): number | null {
  if (!a || !a.energy.length) return null;
  return a.energy.reduce((x, y) => x + y, 0) / a.energy.length;
}

/** 從作品產生視覺聖經: derive the bible from the band's songs and library, save it -> { band, engine, logs } */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const band = await getBand(id);
  if (!band) throw new HttpError(404, "找不到樂團");
  const songs = await bandProjects(id);
  const logs: string[] = [];
  const bible = await generateBible(
    {
      bandName: band.name,
      songs: songs.map((p) => ({ title: p.meta.title, plan: p.plan, research: p.research, energy: meanEnergy(p.analysis) })),
      assets: band.assets,
      current: band.bible,
    },
    { signal: req.signal, onLog: (m) => logs.push(m) },
  );
  const saved = await updateBand(id, (b) => {
    b.bible = bible;
  });
  return json({ band: saved, engine: bible.source?.engine === "claude" ? "claude" : "offline", logs });
});
