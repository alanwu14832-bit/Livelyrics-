import { MAX_ASSETS_PER_PROJECT } from "@/lib/assets";
import { isJsonRequest, receiveAssetRegistration, receiveAssetUpload } from "@/lib/server/asset-routes";
import { takenAssetIds } from "@/lib/server/band-storage";
import { handle, HttpError, json, requireProjectId } from "@/lib/server/http";
import { addAsset, getProject } from "@/lib/server/storage";
import { isCloudStorage } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const project = await getProject(id);
  if (!project) throw new HttpError(404, "找不到專案");
  return json({ assets: project.assets });
});

/**
 * Local: multipart `file` (image / video) + `meta` JSON { width, height, duration?, name?, kind?, note?, tags? } measured in the browser.
 * Cloud: JSON { blob, fileName, width, height, ... } after the browser uploaded the file to Vercel Blob.
 */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireProjectId((await ctx.params).id);
  const existing = await getProject(id);
  if (!existing) throw new HttpError(404, "找不到專案");
  const taken = await takenAssetIds(existing.bandId);
  for (const a of existing.assets) taken.add(a.id);
  if (isCloudStorage()) {
    if (!isJsonRequest(req)) throw new HttpError(400, "雲端模式請先把檔案上傳到 Vercel Blob，再登記到這裡。");
    return receiveAssetRegistration(req, {
      prefix: `projects/${id}/`,
      count: existing.assets.length,
      max: MAX_ASSETS_PER_PROJECT,
      taken,
      store: async (asset) => (await addAsset(id, asset, null, MAX_ASSETS_PER_PROJECT)).assets,
    });
  }
  return receiveAssetUpload(req, {
    count: existing.assets.length,
    max: MAX_ASSETS_PER_PROJECT,
    taken,
    store: async (asset, tempPath) => (await addAsset(id, asset, tempPath, MAX_ASSETS_PER_PROJECT)).assets,
  });
});
