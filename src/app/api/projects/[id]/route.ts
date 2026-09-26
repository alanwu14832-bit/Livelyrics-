import { handle, HttpError, json, readJson, requireProjectId } from "@/lib/server/http";
import { cancelRun, withLiveStatus } from "@/lib/server/pipeline";
import { deleteProject, getProject, updateProject } from "@/lib/server/storage";
import { applyMetaPatch, parseLyricsPatch, parsePlanPatch } from "@/lib/server/validate";
import type { DesignPlan, Lyrics, SongMeta } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_PATCH_BYTES = 8 * 1024 * 1024;

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  return json(withLiveStatus(project));
});

export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const body = await readJson(req, MAX_PATCH_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { meta?, lyrics?, plan? }");
  const patch = body as Record<string, unknown>;

  // validate everything before touching the file
  let lyrics: Lyrics | undefined;
  let plan: DesignPlan | undefined;
  if (patch.lyrics !== undefined) lyrics = parseLyricsPatch(patch.lyrics);
  if (patch.plan !== undefined) plan = parsePlanPatch(patch.plan);
  if (patch.meta !== undefined && (typeof patch.meta !== "object" || patch.meta === null || Array.isArray(patch.meta))) {
    throw new HttpError(400, "meta 必須是物件");
  }

  const existing = await getProject(id);
  if (!existing) throw new HttpError(404, "找不到專案");
  let meta: SongMeta | undefined;
  if (patch.meta !== undefined) meta = applyMetaPatch(existing.meta, patch.meta);
  if (!meta && !lyrics && !plan) return json(withLiveStatus(existing));

  const saved = await updateProject(id, (p) => {
    if (meta) p.meta = applyMetaPatch(p.meta, patch.meta);
    if (lyrics) p.lyrics = lyrics;
    if (plan) p.plan = plan;
  });
  return json(withLiveStatus(saved));
});

export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  cancelRun(id, { discard: true });
  const existed = await deleteProject(id);
  if (!existed) throw new HttpError(404, "找不到專案");
  return json({ ok: true as const });
});
