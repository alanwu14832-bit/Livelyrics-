// 用 claude.ai 研究 (manual Claude mode), the server side of POST /api/projects/[id]/manual: the
// prompt for a project (its design request with the band's bible, libraries and mood board, the
// output canvas and LED 安全模式), and applying a pasted reply — re-validated here whatever the
// browser checked — as the design plan (the old one kept for 復原) or as the design directions,
// with the reply's research brief, all marked manual-claude.

import type { ManualApplyResult, ManualPromptResult, ManualTarget } from "@/lib/api-client";
import { buildManualPrompt } from "@/lib/server/designer/manual";
import { extractBrief, MAX_BRIEF_CHARS, readManualReply } from "@/lib/server/designer/manual-reply";
import { DesignPlanSchema } from "@/lib/schema";
import { projectSafety } from "@/lib/stage/safety";
import type { Project } from "@/lib/types";
import { withBandAssets } from "./band-storage";
import { designRequestFor } from "./directions";
import { HttpError } from "./http";
import { withLiveStatus } from "./pipeline";
import { getProject, updateProject } from "./storage";

async function requireProject(id: string): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  return project;
}

/** The complete claude.ai prompt for the song (精簡版 with `compact`). */
export async function manualPromptForProject(id: string, opts: { target: ManualTarget; compact?: boolean; instruction?: string }): Promise<ManualPromptResult> {
  const project = await requireProject(id);
  const req = await designRequestFor(project, { vision: false });
  const instruction = opts.instruction?.trim();
  if (instruction) req.instruction = instruction.slice(0, 600);
  return buildManualPrompt(req, { target: opts.target, compact: opts.compact, output: project.output });
}

/**
 * Apply a pasted claude.ai reply. 422 with the problems and a 修正提示詞 when it cannot be used;
 * `brief` is a research brief kept from an earlier reply of the same chat (a JSON-only fix).
 */
export async function manualApplyForProject(id: string, input: { target: ManualTarget; reply: string; brief?: string }): Promise<{ status: 200 | 422; body: ManualApplyResult }> {
  const project = await requireProject(id);
  if (withLiveStatus(project).status === "processing") throw new HttpError(409, "這首歌正在處理中，完成後再套用 claude.ai 的回覆。");
  const req = await designRequestFor(project, { vision: false });
  const now = new Date().toISOString();
  const outcome = readManualReply(input.reply, input.target, req, { safety: projectSafety(project), now });
  const brief = outcome.brief ?? (input.brief ? extractBrief(input.brief.slice(0, MAX_BRIEF_CHARS), null) : null);
  if (!outcome.ok) {
    return { status: 422, body: { ok: false, error: outcome.error, issues: outcome.issues, fixPrompt: outcome.fixPrompt, ...(brief ? { brief: brief.brief } : {}) } };
  }
  const plan = outcome.plan ? DesignPlanSchema.parse(outcome.plan) : null;
  const saved = await updateProject(id, (p) => {
    if (plan) {
      if (p.plan) p.previousPlan = { plan: p.plan, at: now, reason: "套用 claude.ai 的設計方案", ...(p.planSource ? { source: p.planSource } : {}) };
      else delete p.previousPlan;
      p.plan = plan;
      p.planSource = { engine: "manual-claude", at: now };
      // the pasted plan replaces an adopted direction
      for (const d of p.directions?.directions ?? []) if (d.status === "selected") d.status = "proposed";
      if (p.status !== "ready") {
        p.status = "ready";
        delete p.error;
      }
    }
    if (outcome.directions) {
      p.directions = { engine: "manual-claude", createdAt: now, directions: outcome.directions };
      delete p.directionsJob;
    }
    if (brief) {
      // the public facts a free research found stay cached for later runs
      const publicInfo = p.research?.publicInfo;
      p.research = { brief: brief.brief, sources: brief.sources, engine: "manual-claude", createdAt: now, ...(publicInfo ? { publicInfo } : {}) };
    }
  });
  return {
    status: 200,
    body: { ok: true, project: withLiveStatus(await withBandAssets(saved)), target: input.target, notes: outcome.notes, safety: outcome.safety, research: !!brief },
  };
}
