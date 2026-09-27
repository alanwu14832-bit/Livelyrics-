import { MAX_BAND_ASSETS } from "@/lib/band";
import { isJsonRequest, receiveAssetRegistration, receiveAssetUpload } from "@/lib/server/asset-routes";
import { addBandAsset, getBand, takenAssetIds } from "@/lib/server/band-storage";
import { handle, HttpError, json, requireBandId } from "@/lib/server/http";
import { isCloudStorage } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (_req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const band = await getBand(id);
  if (!band) throw new HttpError(404, "找不到樂團");
  return json({ assets: band.assets });
});

/** Same contract as the project library: multipart `file` + `meta` JSON (local) or a Blob registration (cloud) -> 201 { asset, assets } */
export const POST = handle(async (req: Request, ctx: Ctx) => {
  const id = requireBandId((await ctx.params).id);
  const band = await getBand(id);
  if (!band) throw new HttpError(404, "找不到樂團");
  const taken = await takenAssetIds(id);
  if (isCloudStorage()) {
    if (!isJsonRequest(req)) throw new HttpError(400, "雲端模式請先把檔案上傳到 Vercel Blob，再登記到這裡。");
    return receiveAssetRegistration(req, {
      prefix: `bands/${id}/`,
      count: band.assets.length,
      max: MAX_BAND_ASSETS,
      taken,
      label: "樂團素材",
      store: async (asset) => (await addBandAsset(id, asset, null, MAX_BAND_ASSETS)).assets,
    });
  }
  return receiveAssetUpload(req, {
    count: band.assets.length,
    max: MAX_BAND_ASSETS,
    taken,
    label: "樂團素材",
    store: async (asset, tempPath) => (await addBandAsset(id, asset, tempPath, MAX_BAND_ASSETS)).assets,
  });
});
