// 設計方向提案與樂團確認 (phase 4), the server side: the designer input of a song (band bible,
// libraries, mood board and the mood board images for Claude's vision input, read from storage),
// and the project changes behind POST /api/projects/[id]/directions: propose, revise one
// direction with a note (the redesign-with-instruction path), select (becomes the plan, the old
// plan kept for undo), undo, status and comments.

import { stageAssets } from "@/lib/asset-scope";
import { applyComment, applySelection, applyStatus, applyUndo, findDirection, removeComment } from "@/lib/directions";
import { mergedMoodboard } from "@/lib/moodboard";
import * as designer from "@/lib/server/designer";
import type { DesignerCallbacks, DesignerDeps, DesignRequest, VisionImage } from "@/lib/server/designer";
import { isVisionMediaType, MAX_VISION_IMAGE_BYTES, MAX_VISION_TOTAL_BYTES } from "@/lib/server/designer/moodboard";
import { DesignPlanSchema } from "@/lib/schema";
import type { DesignDirection, DirectionEngine, DirectionSet, MoodImage, Project } from "@/lib/types";
import { bandAssetFileOf, getBand } from "./band-storage";
import { HttpError } from "./http";
import { assetFileOf, getProject, updateProject } from "./storage";
import { files } from "./store";

/**
 * The mood board images for Claude, read from storage server-side (never through the browser, so
 * the 4.5 MB request limit does not apply). Uploads were downscaled to 1024 px in the browser;
 * an image that is still too big, of another type or unreadable is skipped (and named in `skipped`).
 */
export async function loadVisionImages(
  project: Pick<Project, "id" | "bandId">,
  moodboard: readonly MoodImage[],
  opts: { signal?: AbortSignal } = {},
): Promise<{ images: VisionImage[]; skipped: string[] }> {
  const images: VisionImage[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const m of moodboard) {
    if (!isVisionMediaType(m.mimeType) || m.bytes > MAX_VISION_IMAGE_BYTES || total + m.bytes > MAX_VISION_TOTAL_BYTES) {
      skipped.push(m.name);
      continue;
    }
    const file = m.scope === "band" && project.bandId ? bandAssetFileOf(project.bandId, m) : assetFileOf(project.id, m);
    try {
      const bytes = await files().read(file, { maxBytes: MAX_VISION_IMAGE_BYTES, signal: opts.signal });
      total += bytes.length;
      images.push({ id: m.id, mediaType: m.mimeType, data: Buffer.from(bytes).toString("base64") });
    } catch {
      skipped.push(m.name);
    }
  }
  return { images, skipped };
}

/** Everything the designer reads for one song (the band's bible, libraries and mood board merged in). */
export async function designRequestFor(project: Project, opts: { vision: boolean; signal?: AbortSignal; onLog?: (m: string) => void }): Promise<DesignRequest> {
  const band = project.bandId ? await getBand(project.bandId).catch(() => null) : null;
  const moodboard = mergedMoodboard({ moodboard: project.moodboard, bandMoodboard: band?.moodboard });
  const req: DesignRequest = {
    meta: project.meta,
    lyrics: project.lyrics,
    analysis: project.analysis,
    assets: stageAssets({ assets: project.assets ?? [], bandAssets: band?.assets ?? [] }),
    bible: band?.bible ?? null,
    bandName: band?.name,
    research: project.research,
    previous: project.plan,
    moodboard,
  };
  if (opts.vision && moodboard.length) {
    const { images, skipped } = await loadVisionImages(project, moodboard, { signal: opts.signal });
    req.moodboardImages = images;
    if (skipped.length) opts.onLog?.(`有 ${skipped.length} 張參考圖無法附給 Claude（${skipped.slice(0, 3).join("、")}），只提供說明與色票。`);
  }
  return req;
}

export interface DirectionsResult {
  project: Project;
  engine: DirectionEngine;
  logs: string[];
}

async function requireProject(id: string): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  return project;
}

/** 提出設計方向: replaces the project's direction set (the plan itself is untouched). */
export async function proposeForProject(id: string, opts: { instruction?: string; signal?: AbortSignal; deps?: DesignerDeps } = {}): Promise<DirectionsResult> {
  const project = await requireProject(id);
  const logs: string[] = [];
  const cb: DesignerCallbacks = { signal: opts.signal, onLog: (m) => logs.push(m) };
  const req = await designRequestFor(project, { vision: opts.deps?.configured ?? designer.isClaudeConfigured(), signal: opts.signal, onLog: (m) => logs.push(m) });
  if (opts.instruction?.trim()) req.instruction = opts.instruction.trim().slice(0, 600);
  const set: DirectionSet = await designer.proposeDirections(req, cb, opts.deps);
  const saved = await updateProject(id, (p) => {
    p.directions = set;
    delete p.directionsJob;
  });
  return { project: saved, engine: set.engine, logs };
}

/**
 * 修改這個方向: the redesign-with-instruction path on the direction's plan (Claude re-designs with
 * the note, the offline designer applies what it understands). The note is kept as a revision
 * comment; a selected direction goes back to 提案中 (select it again to use the new version).
 */
export async function reviseForProject(id: string, directionId: string, note: string, opts: { signal?: AbortSignal; deps?: DesignerDeps } = {}): Promise<DirectionsResult> {
  const project = await requireProject(id);
  const direction = findDirection(project, directionId);
  if (!direction) throw new HttpError(404, "找不到這個設計方向");
  const text = note.trim();
  if (!text) throw new HttpError(400, "請寫下要怎麼修改這個方向");
  const logs: string[] = [];
  const cb: DesignerCallbacks = { signal: opts.signal, onLog: (m) => logs.push(m) };
  const req = await designRequestFor(project, { vision: opts.deps?.configured ?? designer.isClaudeConfigured(), signal: opts.signal, onLog: (m) => logs.push(m) });
  req.previous = direction.plan;
  req.instruction = `這是設計方向 ${direction.letter}「${direction.name}」（${direction.pitch}）。依樂團的意見修改：${text.slice(0, 600)}`;
  const plan = await designer.designSong(req, cb, opts.deps);
  const checked = DesignPlanSchema.safeParse(plan);
  if (!checked.success) throw new Error("修改後的方案格式不正確");
  // designSong's success log names the model; every offline path says 離線
  const engine = logs.some((l) => l.startsWith("設計完成（")) ? "claude" : "offline";
  const now = new Date().toISOString();
  const saved = await updateProject(id, (p) => {
    const d = p.directions?.directions.find((x) => x.id === directionId);
    if (!d) throw new HttpError(404, "這個設計方向已經不在了");
    d.plan = checked.data;
    if (d.status === "selected") d.status = "proposed";
    d.updatedAt = now;
    applyComment(p, directionId, text, now, "revision");
    delete p.directionsJob;
  });
  return { project: saved, engine, logs };
}

/** 採用這個方向: the direction's plan, re-aligned to the current song (lyrics may have changed), becomes the plan. */
export async function selectForProject(id: string, directionId: string): Promise<Project> {
  const project = await requireProject(id);
  const direction = findDirection(project, directionId);
  if (!direction) throw new HttpError(404, "找不到這個設計方向");
  const req = await designRequestFor(project, { vision: false });
  const plan = designer.normalizePlan(direction.plan, req);
  const now = new Date().toISOString();
  return updateProject(id, (p) => {
    try {
      applySelection(p, directionId, plan, now);
    } catch (err) {
      throw new HttpError(404, err instanceof Error ? err.message : "找不到這個設計方向");
    }
  });
}

export async function undoForProject(id: string): Promise<Project> {
  let undone = false;
  const saved = await updateProject(id, (p) => {
    undone = applyUndo(p);
  });
  if (!undone) throw new HttpError(409, "沒有可以復原的方案");
  return saved;
}

export async function statusForProject(id: string, directionId: string, status: "proposed" | "rejected"): Promise<Project> {
  const now = new Date().toISOString();
  return updateProject(id, (p) => {
    try {
      applyStatus(p, directionId, status, now);
    } catch (err) {
      throw new HttpError(409, err instanceof Error ? err.message : "無法變更狀態");
    }
  });
}

export async function commentForProject(id: string, directionId: string, text: string): Promise<Project> {
  const now = new Date().toISOString();
  return updateProject(id, (p) => {
    try {
      applyComment(p, directionId, text, now);
    } catch (err) {
      throw new HttpError(400, err instanceof Error ? err.message : "無法加入意見");
    }
  });
}

export async function uncommentForProject(id: string, directionId: string, commentId: string): Promise<Project> {
  return updateProject(id, (p) => {
    removeComment(p, directionId, commentId);
  });
}

/** 清除提案 */
export async function clearForProject(id: string): Promise<Project> {
  return updateProject(id, (p) => {
    delete p.directions;
  });
}

export type { DesignDirection };
