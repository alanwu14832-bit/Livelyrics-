import { songItems } from "@/lib/show";
import { bandProjects, getBand, getShow, updateShow } from "@/lib/server/band-storage";
import { planShowArc } from "@/lib/server/designer";
import { handle, HttpError, json, requireShowId } from "@/lib/server/http";
import type { AudioAnalysis } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

type Ctx = { params: Promise<{ id: string }> };

function meanEnergy(a: AudioAnalysis | null): number | null {
  if (!a || !a.energy.length) return null;
  return a.energy.reduce((x, y) => x + y, 0) / a.energy.length;
}

/** 整場弧線: plan per-song energy / palette emphasis / notes for the setlist, save it -> { show, engine, logs } */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireShowId((await ctx.params).id);
  const show = await getShow(id);
  if (!show) throw new HttpError(404, "找不到演出");
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
  const logs: string[] = [];
  const arc = await planShowArc({ showName: show.name, bandName: band?.name ?? "", bible: band?.bible ?? null, songs }, { signal: req.signal, onLog: (m) => logs.push(m) });
  const saved = await updateShow(id, (s) => {
    s.arc = arc;
  });
  return json({ show: saved, engine: arc.engine, logs });
});
