import { songItems } from "@/lib/show";
import { getShow } from "@/lib/server/band-storage";
import { handle, HttpError, json, requireShowId } from "@/lib/server/http";
import { getProject, updateProject } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Copy the show's output canvas (size, preset, lyric safe area) onto every song of its setlist -> { updated, show } */
export const POST = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireShowId((await ctx.params).id);
  const show = await getShow(id);
  if (!show) throw new HttpError(404, "找不到演出");
  let updated = 0;
  for (const projectId of new Set(songItems(show.items).map((s) => s.projectId))) {
    const p = await getProject(projectId).catch(() => null);
    if (!p || p.bandId !== show.bandId) continue;
    await updateProject(projectId, (draft) => {
      draft.output = structuredClone(show.output);
    });
    updated++;
  }
  return json({ updated, show });
});
