import { handle, HttpError, readJson, requireProjectId } from "@/lib/server/http";
import { normalizeSteps, runPipeline } from "@/lib/server/pipeline";
import { pipelineEventStream, SSE_HEADERS } from "@/lib/server/sse";
import { getProject } from "@/lib/server/storage";
import type { PipelineEvent } from "@/lib/types";
import { parseProcessRequest } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Start (or attach to) the pipeline and stream its PipelineEvents as SSE. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const request = parseProcessRequest(await readJson(req, MAX_BODY_BYTES, {}));
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");

  const handleRun = runPipeline(id, request);
  const prelude: PipelineEvent[] = [];
  if (handleRun.attached) {
    const differs = JSON.stringify(normalizeSteps(handleRun.run.request.steps)) !== JSON.stringify(normalizeSteps(request.steps)) ||
      (handleRun.run.request.instruction ?? "") !== (request.instruction ?? "") ||
      (handleRun.run.request.lyricsText ?? "") !== (request.lyricsText ?? "");
    const step = normalizeSteps(handleRun.run.request.steps)[0] ?? "lyrics";
    prelude.push({
      type: "log",
      step,
      message: differs
        ? "這首歌已經有一個處理正在進行，已接上它的進度；這次的設定不會套用，完成後可以再執行一次。"
        : "已接上進行中的處理。",
    });
  }

  // a disconnect only ends this stream; the run keeps going and can be re-attached
  const stream = pipelineEventStream(handleRun, { signal: req.signal, prelude });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
});
