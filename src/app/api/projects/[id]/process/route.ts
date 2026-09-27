import { handle, HttpError, readJson, requireProjectId } from "@/lib/server/http";
import { attachToRun, normalizeSteps, runPipeline, withLiveStatus } from "@/lib/server/pipeline";
import { eventListStream, pipelineEventStream, SSE_HEADERS } from "@/lib/server/sse";
import { withBandAssets } from "@/lib/server/band-storage";
import { getProject } from "@/lib/server/storage";
import type { PipelineEvent, Project } from "@/lib/types";
import { parseProcessRequest } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** What an attach-only watcher gets when no run is in memory: the stored outcome. */
function storedOutcome(project: Project): PipelineEvent {
  const p = withLiveStatus(project);
  if (p.status === "ready" && p.plan) return { type: "done", project: p };
  if (p.status === "error") return { type: "error", message: p.error || "上次的處理沒有完成，請重新處理。" };
  return { type: "error", message: "目前沒有進行中的處理。" };
}

/** Start (or attach to) the pipeline and stream its PipelineEvents as SSE. */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const request = parseProcessRequest(await readJson(req, MAX_BODY_BYTES, {}));
  const stored = await getProject(id);
  if (!stored) throw new HttpError(404, "找不到專案");
  const project = await withBandAssets(stored);

  if (request.attachOnly) {
    const watched = attachToRun(id);
    if (!watched) return new Response(eventListStream([storedOutcome(project)]), { status: 200, headers: SSE_HEADERS });
    const prelude: PipelineEvent[] = [{ type: "attached", steps: normalizeSteps(watched.run.request.steps), sameRequest: true }];
    return new Response(pipelineEventStream(watched, { signal: req.signal, prelude }), { status: 200, headers: SSE_HEADERS });
  }

  const handleRun = runPipeline(id, request);
  const prelude: PipelineEvent[] = [];
  if (handleRun.attached) {
    const runSteps = normalizeSteps(handleRun.run.request.steps);
    const sameRequest =
      JSON.stringify(runSteps) === JSON.stringify(normalizeSteps(request.steps)) &&
      (handleRun.run.request.instruction ?? "") === (request.instruction ?? "") &&
      (handleRun.run.request.lyricsText ?? "") === (request.lyricsText ?? "");
    prelude.push({ type: "attached", steps: runSteps, sameRequest });
    prelude.push({
      type: "log",
      step: runSteps[0] ?? "lyrics",
      message: sameRequest
        ? "已接上進行中的處理。"
        : "這首歌已經有一個處理正在進行，已接上它的進度；這次的設定不會套用，完成後可以再執行一次。",
    });
  }

  // a disconnect only ends this stream; the run keeps going and can be re-attached
  const stream = pipelineEventStream(handleRun, { signal: req.signal, prelude });
  return new Response(stream, { status: 200, headers: SSE_HEADERS });
});
