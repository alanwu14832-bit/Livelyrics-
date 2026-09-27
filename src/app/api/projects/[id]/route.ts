import { handle, HttpError, json, readJson, requireProjectId } from "@/lib/server/http";
import { remapPlanLines } from "@/lib/lyrics/remap";
import { cancelRun, withLiveStatus } from "@/lib/server/pipeline";
import { deleteProject, getProject, updateProject } from "@/lib/server/storage";
import { applyMetaPatch, applyOutputPatch, parseLyricsPatch, parsePlanPatch } from "@/lib/server/validate";
import type { DesignPlan, Lyrics, ProjectOutput, SongMeta } from "@/lib/types";

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
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { meta?, lyrics?, plan?, output? }");
  const patch = body as Record<string, unknown>;

  // validate everything before touching the file
  let lyrics: Lyrics | undefined;
  let plan: DesignPlan | undefined;
  if (patch.lyrics !== undefined) lyrics = parseLyricsPatch(patch.lyrics);
  if (patch.plan !== undefined) plan = parsePlanPatch(patch.plan);
  if (patch.meta !== undefined && (typeof patch.meta !== "object" || patch.meta === null || Array.isArray(patch.meta))) {
    throw new HttpError(400, "meta 必須是物件");
  }
  if (patch.output !== undefined && (typeof patch.output !== "object" || patch.output === null || Array.isArray(patch.output))) {
    throw new HttpError(400, "output 必須是物件");
  }

  const existing = await getProject(id);
  if (!existing) throw new HttpError(404, "找不到專案");
  let meta: SongMeta | undefined;
  if (patch.meta !== undefined) meta = applyMetaPatch(existing.meta, patch.meta);
  let output: ProjectOutput | undefined;
  if (patch.output !== undefined) output = applyOutputPatch(existing.output, patch.output);
  if (!meta && !lyrics && !plan && !output) return json(withLiveStatus(existing));

  const saved = await updateProject(id, (p) => {
    if (meta) p.meta = applyMetaPatch(p.meta, patch.meta);
    if (lyrics) {
      // ids are re-numbered on every lyrics save: keep per-line designs on the same text
      if (!plan && p.plan) p.plan = remapPlanLines(p.plan, p.lyrics, lyrics);
      p.lyrics = lyrics;
    }
    if (plan) p.plan = plan;
    if (output) p.output = applyOutputPatch(p.output, patch.output);
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
