import { after } from "next/server";
import { bandProjects, getBand, updateBand } from "@/lib/server/band-storage";
import { generateBible } from "@/lib/server/designer";
import { handle, HttpError, json, requireBandId } from "@/lib/server/http";
import { errorText, isJobRunning } from "@/lib/server/jobs";
import { CLOUD_DESIGNER_BUDGET_MS } from "@/lib/server/pipeline";
import { isCloudStorage } from "@/lib/server/store";
import type { AudioAnalysis, Band, Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Claude may think for a while. 300 s is the Vercel Hobby ceiling; a larger value fails the deploy.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

function meanEnergy(a: AudioAnalysis | null): number | null {
  if (!a || !a.energy.length) return null;
  return a.energy.reduce((x, y) => x + y, 0) / a.energy.length;
}

function bibleInput(band: Band, songs: Project[]) {
  return {
    bandName: band.name,
    songs: songs.map((p) => ({ title: p.meta.title, plan: p.plan, research: p.research, energy: meanEnergy(p.analysis) })),
    assets: band.assets,
    current: band.bible,
  };
}

/**
 * Cloud: the job is recorded on the band (bibleJob) and finishes even if the page goes away (it is
 * not tied to this request's connection); Claude has a budget inside the time limit.
 */
async function generateRecorded(id: string, band: Band): Promise<Response> {
  const startedAt = new Date().toISOString();
  await updateBand(id, (b) => {
    if (isJobRunning(b.bibleJob)) throw new HttpError(409, "正在從作品產生視覺聖經，完成後會自動更新。");
    b.bibleJob = { status: "running", startedAt };
  });
  const logs: string[] = [];
  const work = (async () => {
    const bible = await generateBible(bibleInput(band, await bandProjects(id)), { onLog: (m) => logs.push(m) }, { timeoutMs: CLOUD_DESIGNER_BUDGET_MS });
    const saved = await updateBand(id, (b) => {
      b.bible = bible;
      delete b.bibleJob;
    });
    return { saved, engine: bible.source?.engine === "claude" ? ("claude" as const) : ("offline" as const) };
  })().catch(async (err: unknown) => {
    await updateBand(id, (b) => {
      if (b.bibleJob?.startedAt === startedAt) b.bibleJob = { status: "error", startedAt, message: errorText(err) };
    }).catch(() => {});
    throw err;
  });
  after(work.catch(() => {}));
  const { saved, engine } = await work;
  return json({ band: saved, engine, logs });
}

/** 從作品產生視覺聖經: derive the bible from the band's songs and library, save it -> { band, engine, logs } */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const band = await getBand(id);
  if (!band) throw new HttpError(404, "找不到樂團");
  if (isCloudStorage()) return generateRecorded(id, band);
  const songs = await bandProjects(id);
  const logs: string[] = [];
  const bible = await generateBible(bibleInput(band, songs), { signal: req.signal, onLog: (m) => logs.push(m) });
  const saved = await updateBand(id, (b) => {
    b.bible = bible;
  });
  return json({ band: saved, engine: bible.source?.engine === "claude" ? "claude" : "offline", logs });
});
