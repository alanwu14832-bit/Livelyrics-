import { isAssetId } from "@/lib/assets";
import { mimeForAssetFile } from "@/lib/server/asset-files";
import { serveFile } from "@/lib/server/file-response";
import { handle, HttpError, json, readJson, requireProjectId } from "@/lib/server/http";
import { assetPath, getProject, removeAsset, updateProject } from "@/lib/server/storage";
import { applyAssetPatch } from "@/lib/server/validate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; assetId: string }> };

async function ids(ctx: Ctx): Promise<{ id: string; assetId: string }> {
  const p = await ctx.params;
  const id = requireProjectId(p.id);
  if (!isAssetId(p.assetId)) throw new HttpError(400, "無效的素材 ID");
  return { id, assetId: p.assetId };
}

async function serve(req: Request, ctx: Ctx, withBody: boolean): Promise<Response> {
  const { id, assetId } = await ids(ctx);
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  const asset = project.assets.find((a) => a.id === assetId);
  if (!asset) throw new HttpError(404, "找不到素材");
  return serveFile(req, {
    file: assetPath(id, asset),
    contentType: asset.mimeType || mimeForAssetFile(asset.file),
    fileName: asset.name ? `${asset.name}.${asset.file.split(".").pop()}` : asset.file,
    withBody,
    missing: "找不到素材檔案",
    badRange: "要求的素材範圍無效",
  });
}

export const GET = handle((req: Request, ctx: Ctx) => serve(req, ctx, true));
export const HEAD = handle((req: Request, ctx: Ctx) => serve(req, ctx, false));

/** { name?, note?, tags?, kind? } -> { asset, assets } */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id, assetId } = await ids(ctx);
  const body = await readJson(req, 64 * 1024);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HttpError(400, "請求內容必須是物件 { name?, note?, tags? }");
  const existing = await getProject(id);
  if (!existing) throw new HttpError(404, "找不到專案");
  const current = existing.assets.find((a) => a.id === assetId);
  if (!current) throw new HttpError(404, "找不到素材");
  applyAssetPatch(current, body); // validate before taking the lock
  let updated = current;
  const saved = await updateProject(id, (p) => {
    const i = p.assets.findIndex((a) => a.id === assetId);
    if (i < 0) throw new HttpError(404, "找不到素材");
    updated = applyAssetPatch(p.assets[i], body);
    p.assets[i] = updated;
  });
  return json({ asset: updated, assets: saved.assets });
});

/** Deletes the file and clears every plan section that showed it -> { ok, assets, plan } */
export const DELETE = handle(async (_req: Request, ctx: Ctx) => {
  const { id, assetId } = await ids(ctx);
  const saved = await removeAsset(id, assetId);
  if (!saved) throw new HttpError(404, "找不到素材");
  return json({ ok: true as const, assets: saved.assets, plan: saved.plan });
});
