import { mimeForAudioFile } from "@/lib/server/audio-files";
import { handle, HttpError, requireProjectId } from "@/lib/server/http";
import { audioFileOf, getProject } from "@/lib/server/storage";
import { files } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** The song's audio: local files with HTTP Range support; cloud a 307 to the blob (its CDN answers Range). */
async function serve(req: Request, ctx: Ctx, withBody: boolean): Promise<Response> {
  const id = requireProjectId((await ctx.params).id);
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  if (!project.audioFile) throw new HttpError(404, "這個專案沒有音檔");
  return files().serve(req, audioFileOf(project), {
    contentType: project.meta.mimeType || mimeForAudioFile(project.audioFile),
    fileName: project.meta.fileName || project.audioFile,
    withBody,
    missing: "找不到音檔",
    badRange: "要求的音檔範圍無效",
  });
}

export const GET = handle((req: Request, ctx: Ctx) => serve(req, ctx, true));
export const HEAD = handle((req: Request, ctx: Ctx) => serve(req, ctx, false));
