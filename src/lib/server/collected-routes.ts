// 研究找到的素材 (phase 8) HTTP handlers: /api/projects/[id]/collected and
// /api/projects/[id]/collected/[itemId]. The files themselves are served like assets (Range, the
// cloud redirect); an item that is on stage is also served by the project's asset route, so the
// stage, the export and the media picker treat it like an uploaded asset.

import { isAssetId } from "@/lib/assets";
import { sanitizeMoodStats } from "@/lib/moodboard";
import type { CollectedVisual, Project } from "@/lib/types";
import { serveAsset } from "./asset-routes";
import { acknowledgeAuthorization, authorizationFor, collectedFileOf, removeCollected, setCollectedStats, setCollectedUse } from "./collected-storage";
import { HttpError, json, readJson } from "./http";
import { getProject } from "./storage";

async function load(id: string): Promise<Project> {
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  return project;
}

function requireItemId(v: string): string {
  if (!isAssetId(v)) throw new HttpError(400, "無效的素材 ID");
  return v;
}

/** -> { items, authorization } */
export async function listCollected(id: string): Promise<Response> {
  const project = await load(id);
  return json({ items: project.collected ?? [], authorization: await authorizationFor(project) });
}

/** { action: "authorize", note? } -> { items, authorization, project } */
export async function postCollected(req: Request, id: string): Promise<Response> {
  const body = await readJson(req, 8 * 1024, {});
  const o = body && typeof body === "object" && !Array.isArray(body) ? (body as { action?: unknown; note?: unknown }) : {};
  if (o.action !== "authorize") throw new HttpError(400, "不支援的動作（只有 authorize）");
  if (o.note !== undefined && typeof o.note !== "string") throw new HttpError(400, "note 必須是文字");
  await load(id);
  const { project, authorization } = await acknowledgeAuthorization(id, o.note as string | undefined);
  return json({ items: project.collected ?? [], authorization, project });
}

export async function serveCollected(req: Request, id: string, itemId: string, withBody: boolean): Promise<Response> {
  const project = await load(id);
  const item = (project.collected ?? []).find((c) => c.id === requireItemId(itemId));
  if (!item) throw new HttpError(404, "找不到這個素材");
  return serveAsset(req, collectedFileOf(id, item), item, withBody);
}

/** { use?: "stage" | "reference", stats? } -> { item, items, plan } */
export async function patchCollected(req: Request, id: string, itemId: string): Promise<Response> {
  requireItemId(itemId);
  const body = await readJson(req, 16 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { use?, stats? }");
  const patch = body as { use?: unknown; stats?: unknown };
  if (patch.use !== undefined && patch.use !== "stage" && patch.use !== "reference") throw new HttpError(400, "use 必須是 stage 或 reference");
  const stats = patch.stats !== undefined ? sanitizeMoodStats(patch.stats) : undefined;
  if (patch.stats !== undefined && !stats) throw new HttpError(400, "stats 格式不正確");
  let saved: Project | null = await load(id);
  if (!(saved.collected ?? []).some((c) => c.id === itemId)) throw new HttpError(404, "找不到這個素材");
  if (patch.use) saved = await setCollectedUse(id, itemId, patch.use);
  if (saved && stats) saved = await setCollectedStats(id, itemId, stats);
  if (!saved) throw new HttpError(404, "找不到這個素材");
  const item = (saved.collected ?? []).find((c) => c.id === itemId) as CollectedVisual;
  return json({ item, items: saved.collected ?? [], plan: saved.plan });
}

/** 移除: the file and both uses -> { ok, items, plan } */
export async function deleteCollected(id: string, itemId: string): Promise<Response> {
  requireItemId(itemId);
  const saved = await removeCollected(id, itemId);
  if (!saved) throw new HttpError(404, "找不到這個素材");
  return json({ ok: true as const, items: saved.collected ?? [], plan: saved.plan });
}
