import { after } from "next/server";
import { CLOUD_DESIGNER_BUDGET_MS, withLiveStatus } from "@/lib/server/pipeline";
import { withBandAssets } from "@/lib/server/band-storage";
import {
  clearForProject,
  commentForProject,
  proposeForProject,
  reviseForProject,
  selectForProject,
  statusForProject,
  uncommentForProject,
  undoForProject,
  type DirectionsResult,
} from "@/lib/server/directions";
import { handle, HttpError, json, readJson, requireProjectId } from "@/lib/server/http";
import { errorText, isJobRunning } from "@/lib/server/jobs";
import { getProject, updateProject } from "@/lib/server/storage";
import { isCloudStorage } from "@/lib/server/store";
import type { Project } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Claude may think for a while. 300 s is the Vercel Hobby ceiling; a larger value fails the deploy.
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

type Body = {
  action?: unknown;
  directionId?: unknown;
  text?: unknown;
  status?: unknown;
  instruction?: unknown;
  commentId?: unknown;
};

const reply = async (project: Project, extra: Partial<Omit<DirectionsResult, "project">> = {}) => json({ project: withLiveStatus(await withBandAssets(project)), ...extra });

function directionIdOf(body: Body): string {
  if (typeof body.directionId !== "string" || !/^d[a-f0-9]{8}$/.test(body.directionId)) throw new HttpError(400, "缺少設計方向（directionId）");
  return body.directionId;
}

/**
 * Propose / revise run the designer (Claude within the cloud budget, then the offline designer).
 * Cloud: recorded on the project (directionsJob) so a refreshed page sees it and it finishes even
 * when the page goes away; one at a time (409).
 */
async function recorded(id: string, run: () => Promise<DirectionsResult>): Promise<Response> {
  if (!isCloudStorage()) {
    const r = await run();
    return reply(r.project, { engine: r.engine, logs: r.logs });
  }
  const startedAt = new Date().toISOString();
  await updateProject(id, (p) => {
    if (isJobRunning(p.directionsJob)) throw new HttpError(409, "設計師正在準備設計方向，完成後會自動更新。");
    p.directionsJob = { status: "running", startedAt };
  });
  const work = run().catch(async (err: unknown) => {
    await updateProject(id, (p) => {
      if (p.directionsJob?.startedAt === startedAt) p.directionsJob = { status: "error", startedAt, message: errorText(err) };
    }).catch(() => {});
    throw err;
  });
  after(work.catch(() => {}));
  const r = await work;
  return reply(r.project, { engine: r.engine, logs: r.logs });
}

/**
 * 設計方向: { action, ... } -> { project, engine?, logs? }
 *   generate { instruction? }            提出設計方向（2–3 個）
 *   revise   { directionId, text }       依意見修改一個方向
 *   select   { directionId }             採用這個方向（成為設計方案；原方案可復原）
 *   undo                                 復原採用前的方案
 *   status   { directionId, status }     "rejected"（退回）/ "proposed"（重新提案）
 *   comment  { directionId, text }       加一則樂團意見
 *   uncomment { directionId, commentId }
 *   clear                                清除提案
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const raw = await readJson(req, 64 * 1024);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "請求內容必須是物件 { action }");
  const body = raw as Body;
  if (!(await getProject(id))) throw new HttpError(404, "找不到專案");
  const deps = { timeoutMs: CLOUD_DESIGNER_BUDGET_MS };
  const text = typeof body.text === "string" ? body.text : "";
  switch (body.action) {
    case "generate": {
      const instruction = typeof body.instruction === "string" ? body.instruction : undefined;
      return recorded(id, () => proposeForProject(id, { instruction, signal: isCloudStorage() ? undefined : req.signal, deps }));
    }
    case "revise": {
      const directionId = directionIdOf(body);
      return recorded(id, () => reviseForProject(id, directionId, text, { signal: isCloudStorage() ? undefined : req.signal, deps }));
    }
    case "select":
      return reply(await selectForProject(id, directionIdOf(body)));
    case "undo":
      return reply(await undoForProject(id));
    case "status": {
      if (body.status !== "rejected" && body.status !== "proposed") throw new HttpError(400, "status 必須是 rejected 或 proposed");
      return reply(await statusForProject(id, directionIdOf(body), body.status));
    }
    case "comment":
      return reply(await commentForProject(id, directionIdOf(body), text));
    case "uncomment": {
      if (typeof body.commentId !== "string" || body.commentId.length > 40) throw new HttpError(400, "缺少意見 ID");
      return reply(await uncommentForProject(id, directionIdOf(body), body.commentId));
    }
    case "clear":
      return reply(await clearForProject(id));
    default:
      throw new HttpError(400, "未知的動作（action）");
  }
});
