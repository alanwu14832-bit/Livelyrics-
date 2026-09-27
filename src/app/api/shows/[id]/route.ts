import { applyShowPatch } from "@/lib/show";
import { bandProjects, deleteShow, getBand, getShow, updateShow } from "@/lib/server/band-storage";
import { handle, HttpError, json, readJson, requireShowId } from "@/lib/server/http";
import { withLiveShowJob } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireShowId((await ctx.params).id);
  const show = await getShow(id);
  if (!show) throw new HttpError(404, "找不到演出");
  return json(withLiveShowJob(show));
});

/** { name?, date?, venue?, notes?, items?, output?, arc? } -> Show */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const id = requireShowId((await ctx.params).id);
  const body = await readJson(req, 1024 * 1024);
  const existing = await getShow(id);
  if (!existing) throw new HttpError(404, "找不到演出");
  const band = existing.bandId ? await getBand(existing.bandId) : null;
  const projectIds = new Set((await bandProjects(existing.bandId).catch(() => [])).map((p) => p.id));
  const ctxIds = { projectIds, assetIds: new Set((band?.assets ?? []).map((a) => a.id)) };
  const check = applyShowPatch(existing, body, ctxIds);
  if (!check.ok) throw new HttpError(400, check.error);
  const saved = await updateShow(id, (current) => {
    const r = applyShowPatch(current, body, ctxIds);
    if (r.ok) return r.show;
  });
  return json(withLiveShowJob(saved));
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireShowId((await ctx.params).id);
  const existed = await deleteShow(id);
  if (!existed) throw new HttpError(404, "找不到演出");
  return json({ ok: true as const });
});
