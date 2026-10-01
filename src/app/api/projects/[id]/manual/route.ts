import { handle, HttpError, json, readJson, requireProjectId } from "@/lib/server/http";
import { manualApplyForProject, manualPromptForProject } from "@/lib/server/manual";
import type { ManualTarget } from "@/lib/api-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/** applying a reply may download the material it lists (bounded well inside this) */
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/** the reply (≤ 200 KB of UTF-8, checked again inside) plus a kept brief, as JSON */
const BODY_LIMIT = 400 * 1024;

function targetOf(v: unknown): ManualTarget {
  if (v === undefined || v === "plan") return "plan";
  if (v === "directions") return "directions";
  throw new HttpError(400, "target 必須是 plan 或 directions");
}

/**
 * 用 claude.ai 研究: { action, target, ... }
 *   prompt { target, compact?, instruction? }  -> ManualPromptResult（要貼到 claude.ai 的完整提示詞）
 *   apply  { target, reply, brief? }           -> { ok: true, project, notes, safety, research }
 *                                                 or 422 { ok: false, error, issues, fixPrompt, brief? }
 * The pasted reply is untrusted text: it is only scanned and validated, never evaluated.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const raw = await readJson(req, BODY_LIMIT);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "請求內容必須是物件 { action }");
  const body = raw as Record<string, unknown>;
  const target = targetOf(body.target);
  switch (body.action) {
    case "prompt":
      return json(
        await manualPromptForProject(id, {
          target,
          compact: body.compact === true,
          instruction: typeof body.instruction === "string" ? body.instruction.slice(0, 4000) : undefined,
        }),
      );
    case "apply": {
      if (typeof body.reply !== "string") throw new HttpError(400, "缺少 Claude 的回覆（reply）");
      const r = await manualApplyForProject(id, { target, reply: body.reply, brief: typeof body.brief === "string" ? body.brief : undefined });
      return json(r.body, { status: r.status });
    }
    default:
      throw new HttpError(400, "未知的動作（action）");
  }
});
