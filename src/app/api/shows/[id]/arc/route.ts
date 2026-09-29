import { after } from "next/server";
import { songItems } from "@/lib/show";
import { bandProjects, getBand, getShow, updateShow } from "@/lib/server/band-storage";
import { planShowArc, type ArcInput } from "@/lib/server/designer";
import { handle, HttpError, json, requireShowId } from "@/lib/server/http";
import { errorText, isJobRunning } from "@/lib/server/jobs";
import { CLOUD_DESIGNER_BUDGET_MS } from "@/lib/server/pipeline";
import { isCloudStorage } from "@/lib/server/store";
import type { AudioAnalysis, Show } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Claude may think for a while. 300 s is the Vercel Hobby ceiling; a larger value fails the deploy.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

function meanEnergy(a: AudioAnalysis | null): number | null {
  if (!a || !a.energy.length) return null;
  return a.energy.reduce((x, y) => x + y, 0) / a.energy.length;
}

async function arcInput(show: Show): Promise<ArcInput> {
  const band = show.bandId ? await getBand(show.bandId) : null;
  const projects = new Map((await bandProjects(show.bandId).catch(() => [])).map((p) => [p.id, p]));
  const songs = songItems(show.items)
    .map((it) => ({ it, p: projects.get(it.projectId) }))
    .filter((x) => x.p)
    .map(({ it, p }) => ({
      itemId: it.id,
      projectId: it.projectId,
      title: p!.meta.title,
      energy: meanEnergy(p!.analysis),
      bpm: p!.analysis?.bpm || null,
      duration: p!.meta.duration || p!.analysis?.duration || 0,
    }));
  if (!songs.length) throw new HttpError(400, "演出清單裡還沒有歌");
  return { showName: show.name, bandName: band?.name ?? "", bible: band?.bible ?? null, songs };
}

/** Cloud: recorded on the show (arcJob), not tied to this request's connection, Claude on a budget. */
async function planRecorded(id: string, show: Show): Promise<Response> {
  const input = await arcInput(show);
  const startedAt = new Date().toISOString();
  await updateShow(id, (s) => {
    if (isJobRunning(s.arcJob)) throw new HttpError(409, "正在規劃整場弧線，完成後會自動更新。");
    s.arcJob = { status: "running", startedAt };
  });
  const logs: string[] = [];
  const work = (async () => {
    const arc = await planShowArc(input, { onLog: (m) => logs.push(m) }, { timeoutMs: CLOUD_DESIGNER_BUDGET_MS });
    const saved = await updateShow(id, (s) => {
      s.arc = arc;
      delete s.arcJob;
    });
    return { saved, engine: arc.engine };
  })().catch(async (err: unknown) => {
    await updateShow(id, (s) => {
      if (s.arcJob?.startedAt === startedAt) s.arcJob = { status: "error", startedAt, message: errorText(err) };
    }).catch(() => {});
    throw err;
  });
  after(work.catch(() => {}));
  const { saved, engine } = await work;
  return json({ show: saved, engine, logs });
}

/** 整場弧線: plan per-song energy / palette emphasis / notes for the setlist, save it -> { show, engine, logs } */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireShowId((await ctx.params).id);
  const show = await getShow(id);
  if (!show) throw new HttpError(404, "找不到演出");
  if (isCloudStorage()) return planRecorded(id, show);
  const input = await arcInput(show);
  const logs: string[] = [];
  const arc = await planShowArc(input, { signal: req.signal, onLog: (m) => logs.push(m) });
  const saved = await updateShow(id, (s) => {
    s.arc = arc;
  });
  return json({ show: saved, engine: arc.engine, logs });
});
