import { applyBiblePatch, sanitizeBandName } from "@/lib/band";
import { deleteBand, getBand, updateBand } from "@/lib/server/band-storage";
import { handle, HttpError, json, readJson, requireBandId } from "@/lib/server/http";
import { withLiveBandJob } from "@/lib/server/jobs";
import type { BandBible } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const band = await getBand(id);
  if (!band) throw new HttpError(404, "找不到樂團");
  return json(withLiveBandJob(band));
});

/** { name?, bible? (partial) } -> Band */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const body = await readJson(req, 256 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { name?, bible? }");
  const patch = body as { name?: unknown; bible?: unknown };
  const existing = await getBand(id);
  if (!existing) throw new HttpError(404, "找不到樂團");
  let name: string | undefined;
  if (patch.name !== undefined) {
    name = sanitizeBandName(patch.name, "");
    if (!name) throw new HttpError(400, "樂團名稱不能是空的");
  }
  if (patch.bible !== undefined) {
    const check = applyBiblePatch(existing.bible, patch.bible);
    if (!check.ok) throw new HttpError(400, check.error);
  }
  const saved = await updateBand(id, (b) => {
    if (name) b.name = name;
    if (patch.bible !== undefined) {
      const r = applyBiblePatch(b.bible, patch.bible);
      if (r.ok) b.bible = r.bible as BandBible;
    }
  });
  return json(withLiveBandJob(saved));
});

/** Deletes the band, its library and its shows; its songs stay, unassigned. */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const existed = await deleteBand(id);
  if (!existed) throw new HttpError(404, "找不到樂團");
  return json({ ok: true as const });
});
