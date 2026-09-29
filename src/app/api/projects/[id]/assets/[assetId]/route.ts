import { isAssetId } from "@/lib/assets";
import { patchAssetInList, readAssetPatch, serveAsset } from "@/lib/server/asset-routes";
import { handle, HttpError, json, requireProjectId } from "@/lib/server/http";
import { assetFileOf, getProject, removeAsset, updateProject } from "@/lib/server/storage";
import type { Asset } from "@/lib/types";

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
  return serveAsset(req, assetFileOf(id, asset), asset, withBody);
}

export const GET = handle((req: Request, ctx: Ctx) => serve(req, ctx, true));
export const HEAD = handle((req: Request, ctx: Ctx) => serve(req, ctx, false));

/** { name?, note?, tags?, kind? } -> { asset, assets } */
export const PATCH = handle(async (req: Request, ctx: Ctx) => {
  const { id, assetId } = await ids(ctx);
  const existing = await getProject(id);
  if (!existing) throw new HttpError(404, "找不到專案");
  const current = existing.assets.find((a) => a.id === assetId);
  if (!current) throw new HttpError(404, "找不到素材");
  const body = await readAssetPatch(req, current);
  let updated: Asset = current;
  const saved = await updateProject(id, (p) => {
    updated = patchAssetInList(p.assets, assetId, body);
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
